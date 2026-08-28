package main

import (
	"log"
	"os"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/media_workstage.db"
	}

	assetDir := os.Getenv("ASSET_DIR")
	if assetDir == "" {
		assetDir = "./assets"
	}

	database, err := db.InitDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Register Provider Adapters
	adapters := map[string]adapter.ProviderAdapter{
		"ark":     adapter.NewFakeProviderAdapter("ark"),
		"minimax": adapter.NewFakeProviderAdapter("minimax"),
	}

	srv := server.NewServer(database, assetDir, adapters)
	r := srv.SetupRouter()

	log.Printf("Starting Media Workstage server on :%s ...", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Server exited with error: %v", err)
	}
}
