package adapter

import (
	"encoding/json"

	"media-workstage/internal/model"
)

func (d *heighlinerDelivery) accountForContents(resp *heighlinerTask) bool {
	if resp.ResultVersion != 1 {
		return false
	}
	listed := make(map[int]bool)
	for _, a := range resp.Artifacts {
		if a.Kind == "image" {
			listed[a.Index] = true
		}
	}
	hasText, hasImage := false, false
	for _, candidate := range resp.Contents {
		for _, part := range candidate.Parts {
			switch part.Type {
			case "text":
				hasText = hasText || part.Text != nil
			case "image":
				hasImage = true
				if part.ArtifactIndex == nil {
					d.expected++
					d.unreadable++
				} else if !listed[*part.ArtifactIndex] {
					d.expected++
					d.unreadable++
					listed[*part.ArtifactIndex] = true
				}
			}
		}
	}
	return hasText && !hasImage && d.expected == 0
}

func layerMetadata(art heighlinerArtifact) *struct {
	ZIndex      *int            `json:"z_index"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	BoundingBox json.RawMessage `json:"bounding_box"`
} {
	var fields struct {
		Volcengine *struct {
			ZIndex      *int            `json:"z_index"`
			Name        string          `json:"name"`
			Description string          `json:"description"`
			BoundingBox json.RawMessage `json:"bounding_box"`
		} `json:"volcengine"`
	}
	_ = json.Unmarshal(art.ProviderMetadata, &fields)
	return fields.Volcengine
}

func applyMediaMetadata(asset *model.TaskAsset, art heighlinerArtifact) {
	asset.ProviderMetadataJSON = string(art.ProviderMetadata)
	asset.ProviderOutputID, asset.Variant, asset.DurationSeconds = art.ProviderOutputID, art.Variant, art.DurationSeconds
}

func applyLayerMetadata(asset *model.TaskAsset, art heighlinerArtifact) {
	m := layerMetadata(art)
	if m == nil {
		return
	}
	asset.Name, asset.Description = m.Name, m.Description
	if len(m.BoundingBox) > 0 && string(m.BoundingBox) != "null" {
		asset.BoundingBoxJSON = string(m.BoundingBox)
	}
	if m.ZIndex != nil {
		asset.ZIndex = *m.ZIndex
		if asset.ZIndex == 0 {
			asset.Kind = "image_base"
		} else if asset.ZIndex > 0 {
			asset.Kind = "image_layer"
		}
	}
}

func validateLayerDelivery(task *model.MediaTask, artifacts []heighlinerArtifact) string {
	if task.TaskType != "image_generation" || len(artifacts) == 0 {
		return ""
	}
	var p struct {
		Options struct {
			Volcengine struct {
				Enabled bool `json:"layer_decomposition"`
				Layer   struct {
					Max int `json:"max_images"`
				} `json:"layer_decomposition_options"`
			} `json:"volcengine"`
		} `json:"provider_options"`
	}
	if json.Unmarshal([]byte(task.ParamsJSON), &p) != nil || !p.Options.Volcengine.Enabled {
		return ""
	}
	limit := 30
	if task.Model == "doubao-seedream-5-0-flash-260915" {
		limit = 17
	} else if v := p.Options.Volcengine.Layer.Max; v >= 2 && v <= 100 {
		limit = v
	}
	seen := make(map[int]bool)
	for _, art := range artifacts {
		if art.Kind != "image" {
			continue
		}
		m := layerMetadata(art)
		if m == nil || m.ZIndex == nil {
			// The metadata can arrive with the result, after the artifact listing did.
			if art.State == "pending" || art.State == "unavailable" {
				continue
			}
			return "图层顺序缺失，不能确认为完整拆图"
		}
		if *m.ZIndex < 0 || seen[*m.ZIndex] {
			return "图层顺序无效或重复，不能确认为完整拆图"
		}
		seen[*m.ZIndex] = true
	}
	if len(seen) > limit {
		return "实际图层数超过拆图上限"
	}
	if !seen[0] {
		return "拆图结果缺少底图"
	}
	return ""
}

func mediaLayerUpdates(artifacts []heighlinerArtifact) map[int]model.TaskAsset {
	var layers map[int]model.TaskAsset
	for _, art := range artifacts {
		if art.Kind != "image" {
			continue
		}
		m := layerMetadata(art)
		if m == nil || m.ZIndex == nil {
			continue
		}
		if layers == nil {
			layers = make(map[int]model.TaskAsset)
		}
		asset := model.TaskAsset{}
		applyMediaMetadata(&asset, art)
		applyLayerMetadata(&asset, art)
		layers[art.Index] = asset
	}
	return layers
}
