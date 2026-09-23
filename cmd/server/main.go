package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"runtime"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"
	"media-workstage/internal/server"
)

//go:embed all:dist
var embeddedDist embed.FS

func openBrowser(targetURL string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", targetURL)
	case "darwin":
		cmd = exec.Command("open", targetURL)
	default:
		cmd = exec.Command("xdg-open", targetURL)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("[INFO] Could not open browser automatically: %v", err)
	}
}

func main() {
	portFlag := flag.String("port", "", "HTTP listen port")
	hostFlag := flag.String("host", "", "HTTP listen host")
	dbFlag := flag.String("db", "", "SQLite database file path")
	assetDirFlag := flag.String("assets", "", "Local assets directory")
	noBrowserFlag := flag.Bool("no-browser", false, "Disable opening default browser on startup")
	flag.Parse()

	port := *portFlag
	if port == "" {
		port = os.Getenv("PORT")
	}
	if port == "" {
		port = "8080"
	}

	host := *hostFlag
	if host == "" {
		host = os.Getenv("HOST")
	}
	if host == "" {
		host = "127.0.0.1" // Secure loopback default
	}

	dbPath := *dbFlag
	if dbPath == "" {
		dbPath = os.Getenv("DB_PATH")
	}
	if dbPath == "" {
		dbPath = "./data/media_workstage.db"
	}

	assetDir := *assetDirFlag
	if assetDir == "" {
		assetDir = os.Getenv("ASSET_DIR")
	}
	if assetDir == "" {
		assetDir = "./assets"
	}

	database, err := db.InitDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Load stored system configuration from SQLite
	var storedConfigs []model.SystemConfig
	_ = database.Find(&storedConfigs)
	configMap := make(map[string]string)
	for _, c := range storedConfigs {
		configMap[c.Key] = c.Value
	}

	// Ark configuration (DB -> ENV fallback)
	arkAPIKey := configMap["ark_api_key"]
	if arkAPIKey == "" {
		arkAPIKey = os.Getenv("ARK_API_KEY")
	}
	arkBaseURL := configMap["ark_base_url"]
	if arkBaseURL == "" {
		arkBaseURL = os.Getenv("ARK_BASE_URL")
	}

	var arkProvider adapter.ProviderAdapter
	if arkAPIKey != "" {
		arkProvider = adapter.NewArkAdapter(adapter.ArkConfig{
			BaseURL: arkBaseURL,
			APIKey:  arkAPIKey,
		})
	} else {
		log.Println("[INFO] ARK_API_KEY not set; using configurable mock provider for ark adapter")
		arkProvider = adapter.NewFakeProviderAdapter("ark")
	}

	// MiniMax configuration (DB -> ENV fallback)
	minimaxAPIKey := configMap["minimax_api_key"]
	if minimaxAPIKey == "" {
		minimaxAPIKey = os.Getenv("MINIMAX_API_KEY")
	}
	minimaxBaseURL := configMap["minimax_base_url"]
	if minimaxBaseURL == "" {
		minimaxBaseURL = os.Getenv("MINIMAX_BASE_URL")
	}
	minimaxGroupID := configMap["minimax_group_id"]
	if minimaxGroupID == "" {
		minimaxGroupID = os.Getenv("MINIMAX_GROUP_ID")
	}

	var minimaxProvider adapter.ProviderAdapter
	if minimaxAPIKey != "" {
		minimaxProvider = adapter.NewMiniMaxAdapter(adapter.MiniMaxConfig{
			BaseURL: minimaxBaseURL,
			APIKey:  minimaxAPIKey,
			GroupID: minimaxGroupID,
		})
	} else {
		log.Println("[INFO] MINIMAX_API_KEY not set; using configurable mock provider for minimax adapter")
		minimaxProvider = adapter.NewFakeProviderAdapter("minimax")
	}

	// Register Provider Adapters
	adapters := map[string]adapter.ProviderAdapter{
		"ark":     arkProvider,
		"minimax": minimaxProvider,
	}

	// Image channels run only with a real key; unconfigured ones stay unregistered.
	for _, name := range []string{"openai", "google", "apimart"} {
		baseURL, apiKey := server.ChannelCredentials(configMap, name)
		if apiKey == "" {
			continue
		}
		if a, ok := adapter.NewChannelAdapter(name, baseURL, apiKey, nil); ok {
			adapters[name] = a
		}
	}

	// One registry shared by the poller and the server, so adapters swapped in by
	// config saves at runtime are the ones the poller dispatches to.
	registry := adapter.NewAdapterRegistry(adapters)

	// Initialize TaskPoller
	taskPoller := poller.NewTaskPoller(poller.TaskPollerConfig{
		DB:       database,
		Registry: registry,
		AssetDir: assetDir,
	})

	// Start background poller and startup recovery
	taskPoller.Start(context.Background())
	defer taskPoller.Stop()

	// Extract embedded dist sub-filesystem
	distSub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		log.Printf("[WARN] Failed to load embedded dist filesystem: %v", err)
	}

	srv := server.NewServer(database, assetDir, registry, taskPoller, distSub)
	r := srv.SetupRouter()

	addr := host + ":" + port
	displayHost := host
	if displayHost == "0.0.0.0" || displayHost == ":" {
		displayHost = "localhost"
	}
	appURL := fmt.Sprintf("http://%s:%s", displayHost, port)

	log.Printf("Starting Media Workstage server on %s (Web UI: %s) ...", addr, appURL)

	// Automatic browser launch
	disableBrowser := *noBrowserFlag || os.Getenv("NO_BROWSER") == "1" || os.Getenv("NO_BROWSER") == "true"
	if !disableBrowser {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(appURL)
		}()
	}

	if err := r.Run(addr); err != nil {
		log.Fatalf("Server exited with error: %v", err)
	}
}
