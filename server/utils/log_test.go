package utils_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"testing"

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
