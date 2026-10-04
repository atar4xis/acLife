package handlers_test

import (
	"net/http"
	"testing"

	"acLife/constants"
	"acLife/internal/testutil"
	"acLife/types"
)

func TestRoot(t *testing.T) {
	c := testutil.NewClient(t)

	status, reply := testutil.Call[any](c, "GET", "/", nil)
	if status != http.StatusOK || !reply.Success || reply.Message != "acLife API v"+constants.Version {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestMetadata(t *testing.T) {
	c := testutil.NewClient(t)

	status, reply := testutil.Call[types.ServerMetadata](c, "GET", "/metadata", nil)
	if status != http.StatusOK || !reply.Success {
		t.Fatalf("got %d %+v", status, reply)
	}
	if reply.Data.URL != "http://localhost:8000/" || reply.Data.Registration.SubscriptionRequired {
		t.Fatalf("unexpected metadata %+v", reply.Data)
	}
}

func TestUnknownRouteReturnsJSON404(t *testing.T) {
	c := testutil.NewClient(t)

	status, reply := testutil.Call[any](c, "GET", "/nope", nil)
	if status != http.StatusNotFound || reply.Success {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestWrongMethodReturnsJSON405(t *testing.T) {
	c := testutil.NewClient(t)

	status, reply := testutil.Call[any](c, "POST", "/", nil)
	if status != http.StatusMethodNotAllowed || reply.Success {
		t.Fatalf("got %d %+v", status, reply)
	}
}
