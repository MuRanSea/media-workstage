package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/stretchr/testify/require"
)

func TestMediaManagement_OnlyCallsOriginalResources(t *testing.T) {
	s, router := newProviderTestServer(t)
	calls := make(chan string, 16)
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls <- r.Method + " " + r.URL.Path
		if r.Header.Get("Authorization") != "Bearer test-media-key" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /media/v1/files":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			purpose := r.FormValue("purpose")
			if purpose == "provider_asset" && r.FormValue("group_id") != "group-1" {
				t.Error("missing group")
			}
			if f, _, err := r.FormFile("file"); err != nil {
				t.Error(err)
			} else {
				f.Close()
			}
			w.WriteHeader(201)
			fmt.Fprintf(w, `{"id":"file_1","purpose":%q,"status":"processing"}`, purpose)
		case "GET /media/v1/files":
			if r.URL.Query().Get("group_id") != "group-1" || r.URL.Query().Get("unexpected") != "" {
				t.Error("wrong list query")
			}
			io.WriteString(w, `{"items":[{"id":"file_1"}],"next_page":2}`)
		case "GET /media/v1/files/file_1":
			io.WriteString(w, `{"id":"file_1","status":"ready","purpose":"provider_asset","asset_id":"asset-1"}`)
		case "DELETE /media/v1/files/file_1":
			w.WriteHeader(204)
		case "GET /media/v1/tasks":
			if r.URL.Query().Get("external_task_ids") != "order-9,order-8" {
				t.Error("missing batch IDs")
			}
			io.WriteString(w, `{"items":[],"has_more":false}`)
		case "POST /media/v1/tasks/query":
			b, _ := io.ReadAll(r.Body)
			if string(b) != `{"cursor":"opaque.x","limit":20}` {
				t.Errorf("wrong cursor request: %s", b)
			}
			io.WriteString(w, `{"items":[],"has_more":true,"next_cursor":"opaque.y"}`)
		case "POST /media/v1/tasks/task_cancel/cancel":
			io.WriteString(w, `{"id":"task_cancel","status":"cancelled"}`)
		case "GET /media/v1/tasks/task_bill":
			io.WriteString(w, `{"id":"task_bill","status":"failed","billing":{"status":"settled","amount":"0.000000","currency":"CNY"}}`)
		default:
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer gw.Close()
	s.registry.Set("heighliner", adapter.NewHeighlinerAdapter(adapter.ChannelConfig{APIKey: "test-media-key", BaseURL: gw.URL, HTTPClient: gw.Client()}))
	const mdl = "doubao-seedance-2-5-260628"
	require.NoError(t, upsertConfigs(s.db, map[string]string{"heighliner_capabilities": `{"` + mdl + `":{"supports_cancel":true}}`}))
	check := func(method, path, ct string, body io.Reader, code int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, body)
		req.Host = "localhost"
		req.Header.Set("Content-Type", ct)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		require.Equal(t, code, w.Code, w.Body.String())
		return w
	}
	for _, purpose := range []string{"reference", "provider_asset"} {
		var buf bytes.Buffer
		form := multipart.NewWriter(&buf)
		require.NoError(t, form.WriteField("purpose", purpose))
		if purpose == "provider_asset" {
			require.NoError(t, form.WriteField("group_id", "group-1"))
		}
		f, err := form.CreateFormFile("file", "example.wav")
		require.NoError(t, err)
		_, err = io.WriteString(f, "fake bytes")
		require.NoError(t, err)
		require.NoError(t, form.Close())
		check("POST", "/api/media/heighliner/files", form.FormDataContentType(), &buf, 201)
	}
	check("GET", "/api/media/heighliner/files?purpose=provider_asset&group_id=group-1&page=1&unexpected=1", "", nil, 200)
	detail := check("GET", "/api/media/heighliner/files/file_1", "", nil, 200)
	require.Contains(t, detail.Body.String(), `"asset_id":"asset-1"`)
	check("DELETE", "/api/media/heighliner/files/file_1", "", nil, 204)
	check("GET", "/api/media/heighliner/tasks?external_task_ids=order-9,order-8", "", nil, 200)
	check("POST", "/api/media/heighliner/tasks/query", "application/json", strings.NewReader(`{"cursor":"opaque.x","limit":20}`), 200)

	task := model.MediaTask{ID: "local-cancel", ProjectID: "p1", Provider: "heighliner", ProviderTaskID: "task_cancel", Model: mdl, TaskType: "video_generation", Status: model.TaskStatusRunning}
	require.NoError(t, s.db.Create(&task).Error)
	check("POST", "/api/tasks/local-cancel/cancel?project_id=wrong", "", nil, 400)
	check("POST", "/api/tasks/local-cancel/cancel?project_id=p1", "", nil, 200)
	require.NoError(t, s.db.First(&task, "id = ?", task.ID).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status, "wait for original poll to confirm cancellation")

	billing := model.MediaTask{ID: "local-bill", ProjectID: "p1", Provider: "heighliner", ProviderTaskID: "task_bill", Model: mdl, Status: model.TaskStatusSucceeded, DeliveryStatus: model.DeliveryComplete, BillingDetailsJSON: `{"status":"reconciling","amount":null}`}
	require.NoError(t, s.db.Create(&billing).Error)
	refresh := check("POST", "/api/tasks/local-bill/billing/refresh?project_id=p1", "", nil, 200)
	require.Contains(t, refresh.Body.String(), "0.000000")
	require.NoError(t, s.db.First(&billing, "id = ?", billing.ID).Error)
	require.Equal(t, model.TaskStatusSucceeded, billing.Status)
	require.Equal(t, model.DeliveryComplete, billing.DeliveryStatus)
	require.Contains(t, billing.BillingDetailsJSON, `"settled"`)
	require.Len(t, calls, 9)
}

func TestMediaCallback_VerifiesRawBodyPersistsSequenceAndDoesNotTrustState(t *testing.T) {
	s, router := newProviderTestServer(t)
	var requests atomic.Int64
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		t.Errorf("unexpected remote request: %s", r.URL.Path)
	}))
	defer gw.Close()
	a := adapter.NewHeighlinerAdapter(adapter.ChannelConfig{APIKey: "sk-callbackFixture-channel", CallbackURL: "https://callbacks.example.test/mote", BaseURL: gw.URL})
	s.registry.Set("heighliner", a)
	task := model.MediaTask{ID: "local", Provider: "heighliner", ProviderTaskID: "task_remote", Model: "a", Status: model.TaskStatusRunning}
	require.NoError(t, s.db.Create(&task).Error)
	body := `{ "object":"media.task.event", "id":"task_remote", "status":"succeeded", "billing":{"amount":"9"} }`
	post := func(event, seq string, when time.Time, raw, signed string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/api/media/callbacks/heighliner", strings.NewReader(raw))
		if event != "" {
			stamp := fmt.Sprint(when.Unix())
			h := hmac.New(sha256.New, []byte("callbackFixture"))
			fmt.Fprint(h, event+"."+seq+"."+stamp+"."+signed)
			req.Header.Set("X-Heighliner-Event-Id", event)
			req.Header.Set("X-Heighliner-Event-Sequence", seq)
			req.Header.Set("X-Heighliner-Signature", "t="+stamp+",v1="+hex.EncodeToString(h.Sum(nil)))
		}
		router.ServeHTTP(w, req)
		return w
	}
	now := time.Now()
	require.Equal(t, 401, post("evt2", "2", now, body+" ", body).Code)
	require.Equal(t, 401, post("evt2", "2", now.Add(-6*time.Minute), body, body).Code)
	challenge := post("", "", now, `{"challenge":"echo-me"}`, "")
	require.Equal(t, 200, challenge.Code)
	require.JSONEq(t, `{"challenge":"echo-me"}`, challenge.Body.String())
	require.Equal(t, 204, post("evt2", "2", now, body, body).Code)
	require.Equal(t, 204, post("evt2", "2", now, body, body).Code)
	require.Equal(t, 204, post("evt1", "1", now, body, body).Code)
	var receipt model.MediaCallbackReceipt
	require.NoError(t, s.db.First(&receipt).Error)
	require.Equal(t, int64(2), receipt.Sequence)
	require.Equal(t, "evt2", receipt.EventID)
	require.NoError(t, s.db.First(&task, "id = ?", task.ID).Error)
	require.Equal(t, model.TaskStatusRunning, task.Status)
	require.Empty(t, task.BillingDetailsJSON)
	require.Zero(t, requests.Load(), "only wake registered poller; never submit from a callback")
	require.NoError(t, a.UpdateConfig("", "sk-rotated-value", nil))
	require.Equal(t, 401, post("evt3", "3", now, body, body).Code)
	require.NoError(t, a.UpdateConfig("", "", map[string]string{"callback_url": ""}))
	require.Equal(t, 404, post("evt3", "3", now, body, body).Code)
}
