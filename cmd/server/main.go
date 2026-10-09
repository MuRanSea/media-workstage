package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/desktop"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"
	"media-workstage/internal/project"
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
	projectsDirFlag := flag.String("projects", "", "Projects root directory (one folder per project)")
	noBrowserFlag := flag.Bool("no-browser", false, "Disable opening default browser on startup")
	settingsFlag := flag.String("settings", "", "Desktop mode: the shell's settings.json (enables the directory settings API)")
	dataDirFlag := flag.String("data-dir", "", "Desktop mode: Data Directory holding data/, assets/ and logs/")
	flag.Parse()

	// The Data Directory lays out the database and global assets the way a
	// checkout does (data/, assets/), so pointing it at an old checkout reuses it.
	dataDir := *dataDirFlag
	if dataDir != "" {
		if *dbFlag == "" {
			*dbFlag = filepath.Join(dataDir, "data", "media_workstage.db")
		}
		if *assetDirFlag == "" {
			*assetDirFlag = filepath.Join(dataDir, "assets")
		}
	}

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

	projectsDir := *projectsDirFlag
	if projectsDir == "" {
		projectsDir = os.Getenv("PROJECTS_DIR")
	}
	if projectsDir == "" {
		projectsDir = "./projects"
	}
	projectStore, err := project.NewStore(projectsDir)
	if err != nil {
		log.Fatalf("Failed to initialize projects directory: %v", err)
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

	// Providers get their adapters from stored config, then env; preset Ark and MiniMax
	// run on mock adapters until they have a key, the rest stay unregistered.
	adapters := server.ProviderAdapters(configMap)

	// One registry shared by the poller and the server, so adapters swapped in by
	// config saves at runtime are the ones the poller dispatches to.
	registry := adapter.NewAdapterRegistry(adapters)

	// Initialize TaskPoller
	taskPoller := poller.NewTaskPoller(poller.TaskPollerConfig{
		DB:       database,
		Registry: registry,
		AssetDir: assetDir,
		// Tasks created inside a project download into that project's folder.
		AssetRoot: func(task *model.MediaTask) string { return projectStore.AssetRoot(task.ProjectID) },
	})

	// Start background poller and startup recovery
	taskPoller.Start(context.Background())
	defer taskPoller.Stop()

	// Extract embedded dist sub-filesystem
	distSub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		log.Printf("[WARN] Failed to load embedded dist filesystem: %v", err)
	}

	opts := []interface{}{taskPoller, distSub, projectStore}
	if *settingsFlag != "" {
		opts = append(opts, &desktop.Mode{
			SettingsPath: *settingsFlag,
			DataDir:      dataDir,
			ProjectsDir:  projectsDir,
			LogsDir:      filepath.Join(dataDir, "logs"),
			Restart: func() {
				taskPoller.Stop()
				os.Exit(desktop.RestartExitCode)
			},
		})
	}
	srv := server.NewServer(database, assetDir, registry, opts...)
	r := srv.SetupRouter()

	// Listen before announcing, so port 0 (desktop mode) resolves to the real port.
	listener, err := net.Listen("tcp", host+":"+port)
	if err != nil {
		log.Fatalf("Failed to listen on %s:%s: %v", host, port, err)
	}
	port = fmt.Sprint(listener.Addr().(*net.TCPAddr).Port)
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

	// The desktop shell waits for this line on stdout before opening its window.
	fmt.Printf("LISTENING %s\n", port)

	if err := r.RunListener(listener); err != nil {
		log.Fatalf("Server exited with error: %v", err)
	}
}
