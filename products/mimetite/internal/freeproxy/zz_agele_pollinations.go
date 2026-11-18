package freeproxy

import (
	"net/http"
	"bytes"
)

// agele's streaming-fallback recorder, ported during the mimetite
// union. mimetite's pollinations.go (the live one) does not carry it.
// bufferingRecorder captures the full response (status, headers, body) without
// writing to the underlying ResponseWriter. Call replay(w) to flush it after
// deciding whether a fallback is needed. Used for the cache path where we
// need the body for caching anyway.
type bufferingRecorder struct {
	header http.Header
	body   *bytes.Buffer
	status int
}

func newBufferingRecorder() *bufferingRecorder {
	return &bufferingRecorder{
		header: make(http.Header),
		body:   &bytes.Buffer{},
		status: 200,
	}
}

func newStreamingFallbackRecorder(w http.ResponseWriter) *streamingFallbackRecorder {
	return &streamingFallbackRecorder{
		w:      w,
		header: make(http.Header),
		status: 200,
	}
}

// streamingFallbackRecorder streams the response through on success (200),
// but suppresses the status/headers/body on 401/429 so the caller can run
// the text.pollinations.ai fallback with a clean ResponseWriter.
type streamingFallbackRecorder struct {
	w           http.ResponseWriter
	header      http.Header
	status      int
	wroteHeader bool
	suppress    bool
}
