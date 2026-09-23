package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerate_OpenAICompatibleChannels(t *testing.T) {
	for _, tc := range []struct{ provider, path string }{
		{"openai", "/v1/chat/completions"},
		{"apimart", "/v1/chat/completions"},
		{"ark", "/v1/chat/completions"},
		{"minimax", "/v1/text/chatcompletion_v2"},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			var got map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, tc.path, r.URL.Path)
				assert.Equal(t, "Bearer k", r.Header.Get("Authorization"))
				_ = json.NewDecoder(r.Body).Decode(&got)
				_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"<think>plan</think>\n 霓虹雨夜，赛博朋克街道 "}}]}`)
			}))
			defer srv.Close()

			text, err := Generate(context.Background(), srv.Client(), tc.provider, srv.URL+"/v1/", "k",
				Request{Model: "m", System: "sys", Prompt: "写一个提示词"})
			require.NoError(t, err)
			assert.Equal(t, "霓虹雨夜，赛博朋克街道", text)
			assert.Equal(t, "m", got["model"])
			if tc.provider == "ark" {
				assert.Equal(t, map[string]any{"type": "disabled"}, got["thinking"], "Doubao thinking is off for prompt writing")
			} else {
				assert.NotContains(t, got, "thinking")
			}
			assert.Equal(t, []any{
				map[string]any{"role": "system", "content": "sys"},
				map[string]any{"role": "user", "content": "写一个提示词"},
			}, got["messages"])
		})
	}
}

func TestGenerate_GeminiSkipsThoughts(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1beta/models/gemini-3-pro:generateContent", r.URL.Path)
		assert.Equal(t, "g", r.Header.Get("x-goog-api-key"))
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"text":"thinking...","thought":true},{"text":"晨雾中的古镇"}]}}]}`)
	}))
	defer srv.Close()

	text, err := Generate(context.Background(), srv.Client(), "google", srv.URL+"/v1beta", "g",
		Request{Model: "models/gemini-3-pro", System: "sys", Prompt: "p"})
	require.NoError(t, err)
	assert.Equal(t, "晨雾中的古镇", text)
	assert.Equal(t, map[string]any{"parts": []any{map[string]any{"text": "sys"}}}, got["systemInstruction"])
}

func TestGenerate_SurfacesProviderErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/text/chatcompletion_v2" {
			_, _ = io.WriteString(w, `{"choices":[],"base_resp":{"status_code":1004,"status_msg":"authentication failed"}}`)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"model not found"}}`)
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), "openai", srv.URL, "k", Request{Model: "x", Prompt: "p"})
	assert.ErrorContains(t, err, "model not found")

	_, err = Generate(context.Background(), srv.Client(), "minimax", srv.URL, "k", Request{Model: "x", Prompt: "p"})
	assert.ErrorContains(t, err, "authentication failed")

	_, err = Generate(context.Background(), srv.Client(), "kling", srv.URL, "k", Request{Model: "x", Prompt: "p"})
	assert.ErrorContains(t, err, "不支持文本生成")
}
