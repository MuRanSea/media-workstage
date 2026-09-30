package adapter

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif" // decoders for image.Decode
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
)

// EncodeImageWithin returns the image at path as a data URI no longer than limit bytes.
// Files that already fit are sent untouched; larger ones are flattened onto white and
// re-encoded as JPEG, shrinking by a fifth per step until they fit. A reference image
// only guides the generation, so the lost resolution does not matter.
func EncodeImageWithin(path string, limit int) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read local file %s: %w", path, err)
	}
	if uri := dataURI(mimeForExt(filepath.Ext(path)), data); len(uri) <= limit {
		return uri, nil
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("图片 %s 有 %.1f MiB，超过内联上限且无法压缩（%v），请先在卡片上「获取链接」",
			filepath.Base(path), float64(len(data))/(1<<20), err)
	}

	b := src.Bounds()
	flat := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), src, b.Min, draw.Over)

	w, h := b.Dx(), b.Dy()
	for step := 0; step < 12 && w >= 16 && h >= 16; step++ {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, downscale(flat, w, h), &jpeg.Options{Quality: 85}); err != nil {
			return "", err
		}
		if uri := dataURI("image/jpeg", buf.Bytes()); len(uri) <= limit {
			return uri, nil
		}
		w, h = w*4/5, h*4/5
	}
	return "", fmt.Errorf("图片 %s 压缩后仍超过内联上限，请先在卡片上「获取链接」", filepath.Base(path))
}

func dataURI(mimeType string, data []byte) string {
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// downscale box-filters src (origin at 0,0) down to w×h; it returns src when not shrinking.
func downscale(src *image.RGBA, w, h int) *image.RGBA {
	sw, sh := src.Bounds().Dx(), src.Bounds().Dy()
	if w >= sw && h >= sh {
		return src
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		y0, y1 := y*sh/h, (y+1)*sh/h
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := range w {
			x0, x1 := x*sw/w, (x+1)*sw/w
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var r, g, bl, n uint32
			for sy := y0; sy < y1; sy++ {
				off := src.PixOffset(x0, sy)
				for sx := x0; sx < x1; sx++ {
					r += uint32(src.Pix[off])
					g += uint32(src.Pix[off+1])
					bl += uint32(src.Pix[off+2])
					off += 4
					n++
				}
			}
			d := dst.PixOffset(x, y)
			dst.Pix[d], dst.Pix[d+1], dst.Pix[d+2], dst.Pix[d+3] = uint8(r/n), uint8(g/n), uint8(bl/n), 255
		}
	}
	return dst
}
