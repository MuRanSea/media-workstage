package model

// Protocol is the API dialect a Provider speaks. It decides which adapter serves the
// Provider and which card kinds it can run; several Providers may share one Protocol.
type Protocol string

const (
	ProtocolArk              Protocol = "ark" // Volcengine Ark native
	ProtocolMiniMax          Protocol = "minimax"
	ProtocolKling            Protocol = "kling"
	ProtocolMidjourney       Protocol = "midjourney" // midjourney-proxy /mj protocol
	ProtocolGemini           Protocol = "gemini"
	ProtocolOpenAICompatible Protocol = "openai_compatible"
	ProtocolAPIMart          Protocol = "apimart"
)
