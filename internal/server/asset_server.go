package server

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// AssetServer serves local media assets with path safety and RFC 7233 Range support.
type AssetServer struct {
	rootDir string
}

func NewAssetServer(rootDir string) *AssetServer {
	cleanRoot, err := filepath.Abs(rootDir)
	if err != nil {
		cleanRoot = rootDir
	}
	_ = os.MkdirAll(filepath.Join(cleanRoot, "images"), 0755)
	_ = os.MkdirAll(filepath.Join(cleanRoot, "videos"), 0755)
	_ = os.MkdirAll(filepath.Join(cleanRoot, "uploads"), 0755)

	return &AssetServer{rootDir: cleanRoot}
}

// RegisterRoutes registers the static asset serving route on Gin.
func (s *AssetServer) RegisterRoutes(r *gin.Engine) {
	r.GET("/assets/*filepath", s.handleServeAsset)
	r.HEAD("/assets/*filepath", s.handleServeAsset)
}

func (s *AssetServer) handleServeAsset(c *gin.Context) {
	serveAssetFile(c, s.rootDir, c.Param("filepath"))
}

// serveAssetFile serves relParam from under rootDir (an absolute path) with
// traversal protection, ETag and Range support.
func serveAssetFile(c *gin.Context, rootDir string, relParam string) {
	cleanSlash := path.Clean("/" + strings.TrimLeft(filepath.ToSlash(relParam), "/"))
	cleanLocalPath := filepath.FromSlash(strings.TrimPrefix(cleanSlash, "/"))
	targetPath := filepath.Join(rootDir, cleanLocalPath)

	// Directory traversal guard
	if targetPath != rootDir && !strings.HasPrefix(targetPath, rootDir+string(filepath.Separator)) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	fileInfo, err := os.Stat(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Asset not found"})
			return
		}
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if fileInfo.IsDir() {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Directory listing disabled"})
		return
	}

	// CORS Headers
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Range, Content-Type, Accept-Encoding")
	c.Header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag")
	c.Header("Accept-Ranges", "bytes")

	// ETag calculation
	etag := fmt.Sprintf(`W/"%x-%x"`, fileInfo.ModTime().UnixNano(), fileInfo.Size())
	c.Header("ETag", etag)

	if match := c.GetHeader("If-None-Match"); match != "" && match == etag {
		c.Status(http.StatusNotModified)
		return
	}

	if strings.HasPrefix(cleanSlash, "/images/") || strings.HasPrefix(cleanSlash, "/videos/") {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		c.Header("Cache-Control", "public, max-age=86400, must-revalidate")
	}

	file, err := os.Open(targetPath)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to open asset"})
		return
	}
	defer file.Close()

	http.ServeContent(c.Writer, c.Request, filepath.Base(targetPath), fileInfo.ModTime(), file)
}
