package adapter

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func ValidateMediaCallbackURL(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || strings.Contains(raw, "#") || (u.Port() != "" && u.Port() != "443") {
		return errors.New("回调必须使用 HTTPS 443，不得含用户名、密码或片段")
	}
	return nil
}

func (a *HeighlinerAdapter) mediaCallback() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.callbackURL
}

func (a *HeighlinerAdapter) UpdateConfig(baseURL, apiKey string, extra map[string]string) error {
	callback, set := extra["callback_url"]
	callback = strings.TrimSpace(callback)
	if err := ValidateMediaCallbackURL(callback); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if baseURL = strings.TrimSpace(baseURL); baseURL != "" {
		a.baseURL = strings.TrimRight(baseURL, "/")
	}
	if apiKey = strings.TrimSpace(apiKey); apiKey != "" {
		a.apiKey = apiKey
	}
	if set {
		a.callbackURL = callback
	}
	return nil
}

// VerifyMediaCallback returns the validated event identity. The raw payload is not trusted
// as a task snapshot: it only tells the original poller to query the attached task ID.
func (a *HeighlinerAdapter) VerifyMediaCallback(h http.Header, body []byte, now time.Time) (string, int64, bool) {
	a.mu.RLock()
	callbackURL, key := a.callbackURL, a.apiKey
	a.mu.RUnlock()
	core, _, _ := strings.Cut(strings.TrimPrefix(key, "sk-"), "-")
	event := h.Get("X-Heighliner-Event-Id")
	sequence := h.Get("X-Heighliner-Event-Sequence")
	timestamp, signature := "", ""
	fields := strings.Split(h.Get("X-Heighliner-Signature"), ",")
	if len(fields) != 2 || callbackURL == "" || core == "" || event == "" || len(event) > 128 || strings.ContainsAny(event, " \t") {
		return "", 0, false
	}
	for _, field := range fields {
		name, value, _ := strings.Cut(strings.TrimSpace(field), "=")
		switch name {
		case "t":
			timestamp = value
		case "v1":
			signature = value
		}
	}
	seq, e1 := strconv.ParseInt(sequence, 10, 64)
	unix, e2 := strconv.ParseInt(timestamp, 10, 64)
	sig, e3 := hex.DecodeString(signature)
	if e1 != nil || e2 != nil || e3 != nil || seq <= 0 || strings.HasPrefix(sequence, "+") || unix < now.Unix()-300 || unix > now.Unix()+300 {
		return "", 0, false
	}
	mac := hmac.New(sha256.New, []byte(core))
	mac.Write([]byte(event + "." + sequence + "." + timestamp + "."))
	mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), sig) {
		return "", 0, false
	}
	return event, seq, true
}

func (a *HeighlinerAdapter) MediaCallbackEnabled() bool {
	return a.mediaCallback() != "" && a.GetConfig().IsConfigured
}
