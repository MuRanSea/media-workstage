package poller

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/google/uuid"
)

// mediaDeliverySession handles only confirmed upstream successes with a distinct
// artifact lifecycle. Other Provider adapters keep their existing task semantics.
type mediaDeliverySession struct {
	latest  *adapter.PollResult
	blocked map[int]bool
}

func (d *mediaDeliverySession) advance(ctx context.Context, p *TaskPoller, task *model.MediaTask, res *adapter.PollResult, provider adapter.ProviderAdapter) bool {
	if res.ResultVersion == 0 && task.ResultVersion > 0 {
		res.ResultVersion, res.Contents = task.ResultVersion, task.Contents
	} else if len(res.Contents) == 0 && len(task.Contents) > 0 && res.ResultVersion == task.ResultVersion {
		res.Contents = task.Contents
	}
	if len(res.ResultActions) == 0 {
		res.ResultActions = task.ResultActions
	}
	d.latest = res
	// Record the confirmed remote success before trying downloads. A restarted worker
	// can reuse the receipts and does not turn a failed follow-up query into a failed run.
	if task.DeliveryStatus != model.DeliveryPending || !reflect.DeepEqual(res.ResultActions, task.ResultActions) || res.ResultVersion != task.ResultVersion || !reflect.DeepEqual(res.Contents, task.Contents) || (res.BillingDetailsJSON != "" && res.BillingDetailsJSON != task.BillingDetailsJSON) {
		task.DeliveryStatus = model.DeliveryPending
		task.ResultActions = res.ResultActions
		task.ResultVersion, task.Contents = res.ResultVersion, res.Contents
		if res.BillingDetailsJSON != "" {
			task.BillingDetailsJSON = res.BillingDetailsJSON
		}
		task.Progress = max(task.Progress, 95)
		if err := p.db.Omit("Assets").Save(task).Error; err != nil {
			log.Printf("[TaskPoller] Error saving delivery state for task %s: %v", task.ID, err)
		}
		p.broadcaster.Broadcast("task.progress", task)
	}

	if res.Delivery.TextOnly && len(task.Assets) == 0 && d.complete(task) {
		d.finish(p, task, "")
		return true
	}
	root, ready := p.deliveryRoot(task)
	if !ready || !p.keepSavedAssets(task, root) {
		return false
	}
	saved := make(map[int]bool, len(task.Assets))
	for i := range task.Assets {
		asset := &task.Assets[i]
		if meta, ok := res.Delivery.Layers[asset.AssetIndex]; ok && (asset.ProviderMetadataJSON != meta.ProviderMetadataJSON || asset.Kind != meta.Kind) {
			// New metadata belongs to an already delivered file. Never redownload it or replace its path/receipt.
			err := p.db.Model(asset).Updates(map[string]any{"kind": meta.Kind, "z_index": meta.ZIndex, "name": meta.Name, "description": meta.Description, "bounding_box_json": meta.BoundingBoxJSON, "provider_metadata_json": meta.ProviderMetadataJSON}).Error
			if err != nil {
				return false
			}
		}
		saved[asset.AssetIndex] = true
	}
	var failed []int
	for _, asset := range res.Assets {
		if ctx.Err() != nil {
			return false
		}
		if saved[asset.AssetIndex] || d.blocked[asset.AssetIndex] {
			continue
		}
		if err := p.saveDeliveredAsset(ctx, task, asset, provider, root); err != nil {
			// Signed URLs are not for logs or user messages.
			log.Printf("[TaskPoller] Could not deliver artifact %d of task %s", asset.AssetIndex, task.ID)
			failed = append(failed, asset.AssetIndex)
			continue
		}
		saved[asset.AssetIndex] = true
	}
	if ctx.Err() != nil {
		return false
	}
	if len(failed) > 0 {
		if retrier, ok := provider.(adapter.DeliveryRetrier); ok && retrier.RetryDelivery(task) {
			return false
		}
		if d.blocked == nil {
			d.blocked = make(map[int]bool)
		}
		for _, index := range failed {
			d.blocked[index] = true
		}
	}
	if res.Delivery.Pending && !d.complete(task) {
		return false
	}
	d.finish(p, task, "")
	return true
}

// A missing project is not evidence that its previously saved files disappeared.
type mediaStore struct {
	path     string
	fallback bool
}

func (p *TaskPoller) deliveryRoot(task *model.MediaTask) (mediaStore, bool) {
	if task.ProjectID != "" && p.assetRoot != nil {
		root, err := p.assetRoot(task.ProjectID)
		if err != nil {
			return mediaStore{}, false
		}
		if root == "" {
			return mediaStore{path: p.assetDir, fallback: true}, true
		}
		// A ZIP import may legitimately omit the empty assets directory. Never create
		// a missing *project* parent during a storage switch.
		if err := os.Mkdir(root, 0755); err != nil && !os.IsExist(err) {
			return mediaStore{}, false
		}
		stat, err := os.Stat(root)
		return mediaStore{path: root}, err == nil && stat.IsDir()
	}
	return mediaStore{path: p.assetDir}, true
}

func (p *TaskPoller) keepSavedAssets(task *model.MediaTask, root mediaStore) bool {
	var present []model.TaskAsset
	for _, asset := range task.Assets {
		if root.fallback && !asset.GlobalFallback {
			present = append(present, asset)
			continue
		}
		location := root.path
		if asset.GlobalFallback {
			location = p.assetDir
		}
		stat, err := os.Stat(filepath.Join(location, asset.LocalPath))
		if err != nil && !os.IsNotExist(err) {
			return false
		}
		if os.IsNotExist(err) && task.ProjectID != "" {
			if _, check := os.Stat(location); check != nil {
				return false
			}
		}
		if asset.DownloadedAt != nil && err == nil && stat.Mode().IsRegular() && stat.Size() > 0 && stat.Size() == asset.FileSizeBytes {
			present = append(present, asset)
		} else if err := p.db.Delete(&asset).Error; err != nil {
			log.Printf("[TaskPoller] Error removing missing artifact receipt for task %s: %v", task.ID, err)
		}
	}
	task.Assets = present
	return true
}

func (p *TaskPoller) saveDeliveredAsset(ctx context.Context, task *model.MediaTask, asset model.TaskAsset, provider adapter.ProviderAdapter, root mediaStore) error {
	asset.GlobalFallback = root.fallback
	target := filepath.Join(root.path, asset.LocalPath)
	if err := provider.DownloadAsset(ctx, asset.RemoteURL, target); err != nil {
		return err
	}
	if renamed := adapter.RenameSniffedModel(target); renamed != target {
		ext := filepath.Ext(renamed)
		asset.LocalPath = strings.TrimSuffix(asset.LocalPath, filepath.Ext(asset.LocalPath)) + ext
		asset.Name = strings.TrimPrefix(ext, ".")
		target = renamed
	}
	stat, err := os.Stat(target)
	if err != nil {
		return err
	}
	if !stat.Mode().IsRegular() || stat.Size() == 0 {
		return fmt.Errorf("artifact is not a non-empty file")
	}
	asset.ID = uuid.NewString()
	asset.TaskID = task.ID
	asset.FileSizeBytes = stat.Size()
	now := time.Now().UTC()
	asset.DownloadedAt = &now
	if err := p.db.Create(&asset).Error; err != nil {
		return err
	}
	task.Assets = append(task.Assets, asset)
	return nil
}

func hasPrimaryMediaAsset(task *model.MediaTask) bool {
	for _, asset := range task.Assets {
		switch task.TaskType {
		case "video_generation":
			if asset.Kind == "video" {
				return true
			}
		case "3d_generation":
			if asset.Kind == "model3d" || asset.Kind == "video" {
				return true
			}
		default:
			return true
		}
	}
	return false
}

func (d *mediaDeliverySession) complete(task *model.MediaTask) bool {
	if d.latest == nil || d.latest.Delivery.Invalid {
		return false
	}
	saved := make(map[int]bool, len(task.Assets))
	for _, a := range task.Assets {
		if layer, ok := d.latest.Delivery.Layers[a.AssetIndex]; ok && (a.Kind != layer.Kind || a.ZIndex != layer.ZIndex || a.ProviderMetadataJSON != layer.ProviderMetadataJSON) {
			return false
		}
		saved[a.AssetIndex] = true
	}
	for idx := range d.latest.Delivery.Layers {
		if !saved[idx] {
			return false
		}
	}
	for _, c := range task.Contents {
		for _, part := range c.Parts {
			if part.Type == "image" && (part.ArtifactIndex == nil || !saved[*part.ArtifactIndex]) {
				return false
			}
		}
	}
	return d.latest.Delivery.TextOnly || (d.latest.Delivery.Expected > 0 && len(task.Assets) == d.latest.Delivery.Expected && hasPrimaryMediaAsset(task))
}

func (d *mediaDeliverySession) finish(p *TaskPoller, task *model.MediaTask, reason string) {
	root, ready := p.deliveryRoot(task)
	verified := len(task.Assets) == 0 || ready && p.keepSavedAssets(task, root)
	if root.fallback {
		for _, asset := range task.Assets {
			if !asset.GlobalFallback {
				verified = false
				break
			}
		}
	}
	res := adapter.PollResult{ResultActions: task.ResultActions, BillingDetailsJSON: task.BillingDetailsJSON, Contents: task.Contents, ResultVersion: task.ResultVersion}
	if d.latest != nil {
		res = *d.latest
		if res.BillingDetailsJSON == "" {
			res.BillingDetailsJSON = task.BillingDetailsJSON
		}
		if reason == "" {
			reason = res.Delivery.Message
		}
	}
	switch {
	case verified && d.complete(task):
		task.DeliveryStatus = model.DeliveryComplete
	case len(task.Assets) > 0:
		task.DeliveryStatus = model.DeliveryPartial
	default:
		task.DeliveryStatus = model.DeliveryUnavailable
	}
	if task.DeliveryStatus == model.DeliveryComplete {
		task.DeliveryMessage = ""
	} else {
		if reason == "" {
			reason = "未能下载全部产物"
		}
		task.DeliveryMessage = fmt.Sprintf("平台已生成，本地保存了 %d 个文件：%s（网关任务 %s）。请勿重新生成，以免重复计费。", len(task.Assets), reason, task.ProviderTaskID)
	}
	p.finishSuccessfulTask(task, &res)
}
