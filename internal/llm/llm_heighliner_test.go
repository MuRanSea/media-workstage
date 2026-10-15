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

func TestGenerate_HeighlinerUsesGatewayRootAndStandardFieldsOnly(t *testing.T) {
	for _, suffix := range []string{"", "/"} {
		t.Run("base"+suffix, func(t *testing.T) {
			var got map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/v1/chat/completions", r.URL.Path)
				assert.Equal(t, "Bearer hl", r.Header.Get("Authorization"))
				_ = json.NewDecoder(r.Body).Decode(&got)
				_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"黄昏海边的灯塔"}}]}`)
			}))
			defer srv.Close()

			text, err := Generate(context.Background(), srv.Client(), model.ProtocolHeighliner, srv.URL+suffix, "hl", Request{
				Model:  "deepseek-flash",
				System: "sys",
				Prompt: "描述图1",
				Images: []string{"data:image/png;base64,AAAA"},
			})
			require.NoError(t, err)
			assert.Equal(t, "黄昏海边的灯塔", text)

			keys := make([]string, 0, len(got))
			for k := range got {
				keys = append(keys, k)
			}
			assert.ElementsMatch(t, []string{"model", "messages"}, keys, "no vendor-specific fields")
			messages := got["messages"].([]any)
			assert.Equal(t, map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "描述图1"},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}},
				},
			}, messages[1])
		})
	}
	assert.True(t, Supported(model.ProtocolHeighliner))
}
