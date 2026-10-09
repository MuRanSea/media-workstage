package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerate_ChatSendsImagesAsVisionParts(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"一位少女在花瓣中"}}]}`)
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), model.ProtocolArk, srv.URL, "k", Request{
		Model:  "doubao",
		Prompt: "描述图1",
		Images: []string{"data:image/png;base64,AAAA", "https://cdn.example.com/b.jpg"},
	})
	require.NoError(t, err)
	messages := got["messages"].([]any)
	assert.Equal(t, map[string]any{
		"role": "user",
		"content": []any{
			map[string]any{"type": "text", "text": "描述图1"},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://cdn.example.com/b.jpg"}},
		},
	}, messages[len(messages)-1])
}

func TestGenerate_GeminiInlinesImages(t *testing.T) {
	image := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("JPEG"))
	}))
	defer image.Close()

	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"text":"雨夜街道"}]}}]}`)
	}))
	defer srv.Close()

	text, err := Generate(context.Background(), srv.Client(), model.ProtocolGemini, srv.URL, "g", Request{
		Model:  "gemini-3-pro",
		Prompt: "看图写提示词",
		Images: []string{"data:image/png;base64,UE5H", image.URL + "/b.jpg"},
	})
	require.NoError(t, err)
	assert.Equal(t, "雨夜街道", text)
	parts := got["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	assert.Equal(t, []any{
		map[string]any{"text": "看图写提示词"},
		map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": "UE5H"}},
		map[string]any{"inlineData": map[string]any{"mimeType": "image/jpeg", "data": "SlBFRw=="}},
	}, parts)
}

func TestGenerate_TextOnlyStaysAPlainString(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer srv.Close()

	_, err := Generate(context.Background(), srv.Client(), model.ProtocolOpenAICompatible, srv.URL, "k", Request{Model: "m", Prompt: "p"})
	require.NoError(t, err)
	messages := got["messages"].([]any)
	assert.Equal(t, "p", messages[0].(map[string]any)["content"], "models without vision still get a plain string")
}
