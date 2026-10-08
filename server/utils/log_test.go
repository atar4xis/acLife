package utils_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	"acLife/utils"
)

func logged(t *testing.T, err error) string {
	t.Helper()

	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	utils.LogError("fn", "action", err)
	return buf.String()
}

func TestLogErrorSkipsCancelledContexts(t *testing.T) {
	for name, err := range map[string]error{
		"plain":   context.Canceled,
		"wrapped": fmt.Errorf("query: %w", context.Canceled),
	} {
		t.Run(name, func(t *testing.T) {
			if got := logged(t, err); got != "" {
				t.Fatalf("logged %q", got)
			}
		})
	}
}

func TestLogErrorStillLogsOtherErrors(t *testing.T) {
	for name, err := range map[string]error{
		"generic":  errors.New("boom"),
		"deadline": context.DeadlineExceeded,
	} {
		t.Run(name, func(t *testing.T) {
			if got := logged(t, err); !strings.Contains(got, "[ERROR] in fn @ action: "+err.Error()) {
				t.Fatalf("logged %q", got)
			}
		})
	}
}

func captureStdout(t *testing.T, f func()) string {
	t.Helper()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = original })

	f()

	_ = w.Close()
	os.Stdout = original
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestLogInfoWritesATimestampedLineToStdout(t *testing.T) {
	before := time.Now().Truncate(time.Second)
	var stderrLog bytes.Buffer
	log.SetOutput(&stderrLog)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	got := captureStdout(t, func() { utils.LogInfo("Running on port %s (%d%%)", "8000", 50) })

	line, ok := strings.CutSuffix(got, "\n")
	if !ok || strings.Contains(line, "\n") {
		t.Fatalf("not exactly one line: %q", got)
	}
	stamp, message, ok := strings.Cut(line, " Running")
	if !ok || message != " on port 8000 (50%)" {
		t.Fatalf("got %q", got)
	}
	when, err := time.ParseInLocation(time.DateTime, stamp, time.Local)
	if err != nil {
		t.Fatalf("timestamp %q: %v", stamp, err)
	}
	if when.Before(before) || when.After(time.Now()) {
		t.Fatalf("timestamp %v is not current", when)
	}
	if stderrLog.Len() != 0 {
		t.Fatalf("also logged %q", stderrLog.String())
	}
}

func TestLogInfoPrintsPercentSignsInArguments(t *testing.T) {
	got := captureStdout(t, func() { utils.LogInfo("usage: %s", "100% sure") })

	if !strings.HasSuffix(got, " usage: 100% sure\n") {
		t.Fatalf("got %q", got)
	}
}
