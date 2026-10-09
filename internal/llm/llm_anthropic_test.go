package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerate_AnthropicMessages(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/messages", r.URL.Path)
		assert.Equal(t, "k", r.Header.Get("x-api-key"))
		assert.Equal(t, "2023-06-01", r.Header.Get("anthropic-version"))
		assert.Empty(t, r.Header.Get("Authorization"), "the key goes only in x-api-key")
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"content":[{"type":"thinking","thinking":"plan"},{"type":"text","text":" 霓虹雨夜，"},{"type":"text","text":"赛博朋克街道 "}],"stop_reason":"end_turn"}`)
	}))
	defer srv.Close()

	text, err := Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL+"/v1/", "k",
		Request{Model: "claude-x", System: "sys", Prompt: "写一个提示词"})
	require.NoError(t, err)
	assert.Equal(t, "霓虹雨夜，赛博朋克街道", text)
	assert.Equal(t, "claude-x", got["model"])
	assert.Equal(t, "sys", got["system"])
	assert.EqualValues(t, 8192, got["max_tokens"])
	assert.NotContains(t, got, "thinking")
	assert.Equal(t, []any{map[string]any{"role": "user", "content": "写一个提示词"}}, got["messages"])
}

func TestGenerate_AnthropicOmitsEmptySystem(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}`)
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL, "k", Request{Model: "m", Prompt: "p"})
	require.NoError(t, err)
	assert.NotContains(t, got, "system")
}

func TestGenerate_AnthropicInlinesImages(t *testing.T) {
	image := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("JPEG"))
	}))
	defer image.Close()

	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"雨夜街道"}],"stop_reason":"end_turn"}`)
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL, "k", Request{
		Model:  "m",
		Prompt: "看图写提示词",
		Images: []string{"data:image/png;base64,UE5H", image.URL + "/b.jpg"},
	})
	require.NoError(t, err)
	assert.Equal(t, []any{map[string]any{
		"role": "user",
		"content": []any{
			map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": "UE5H"}},
			map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/jpeg", "data": "SlBFRw=="}},
			map[string]any{"type": "text", "text": "看图写提示词"},
		},
	}}, got["messages"])
}

func TestGenerate_AnthropicRejectsUnusableImages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("nothing is sent when an image cannot be used")
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL, "k", Request{
		Model: "m", Prompt: "p", Images: []string{"data:image/bmp;base64,Qk0="},
	})
	assert.ErrorContains(t, err, "image/bmp")

	big := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", 4<<20)))
	_, err = Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL, "k", Request{
		Model: "m", Prompt: "p", Images: []string{"data:image/png;base64," + big},
	})
	assert.ErrorContains(t, err, "5 MB")
}

func TestGenerate_AnthropicStopReasons(t *testing.T) {
	for _, tc := range []struct {
		stopReason string
		wantErr    string
	}{
		{"refusal", "模型拒绝回答"},
		{"max_tokens", ""},
	} {
		t.Run(tc.stopReason, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"半截"}],"stop_reason":"`+tc.stopReason+`"}`)
			}))
			defer srv.Close()

			text, err := Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL, "k", Request{Model: "m", Prompt: "p"})
			if tc.wantErr != "" {
				assert.ErrorContains(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "半截", text, "a truncated answer is still returned")
		})
	}
}

func TestGenerate_AnthropicSurfacesErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}`)
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), model.ProtocolAnthropic, srv.URL, "k", Request{Model: "claude-nope", Prompt: "p"})
	assert.ErrorContains(t, err, "model: claude-nope")
}
