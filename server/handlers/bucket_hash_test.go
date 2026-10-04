package handlers_test

import (
	"testing"

	"acLife/handlers"
)

func TestBucketHashMatchesClientVectors(t *testing.T) {
	a := "00000000-0000-4000-8000-000000000001:1790000000001"
	b := "00000000-0000-4000-8000-000000000002:1790000000002"

	cases := []struct {
		name  string
		lines []string
		want  string
	}{
		{"empty", nil, "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="},
		{"two events", []string{b, a}, "btzNbDUHdKllZ4LKVWjw/RXskjBTPxsdfiGY7i6Xh+A="},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := handlers.BucketHash(tc.lines); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestBucketHashIgnoresLineOrder(t *testing.T) {
	a := "00000000-0000-4000-8000-000000000001:1"
	b := "00000000-0000-4000-8000-000000000002:2"

	if handlers.BucketHash([]string{a, b}) != handlers.BucketHash([]string{b, a}) {
		t.Fatal("hash depends on line order")
	}
}

func TestBucketHashDoesNotReorderCallersSlice(t *testing.T) {
	lines := []string{"b:2", "a:1"}
	handlers.BucketHash(lines)

	if lines[0] != "b:2" || lines[1] != "a:1" {
		t.Fatalf("input mutated: %v", lines)
	}
}

func TestBucketHashChangesWithTimestamp(t *testing.T) {
	if handlers.BucketHash([]string{"a:1"}) == handlers.BucketHash([]string{"a:2"}) {
		t.Fatal("timestamp change not reflected")
	}
}
