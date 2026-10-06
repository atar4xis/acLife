package handlers_test

import (
	"net/http"
	"testing"
	"time"

	"acLife/constants"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/mail"
)

func limitMail(t *testing.T, hourly int) {
	t.Helper()

	old := constants.MailHourlyLimit
	constants.MailHourlyLimit = hourly
	handlers.ResetRegistrationLoad()
	t.Cleanup(func() {
		constants.MailHourlyLimit = old
		handlers.ResetRegistrationLoad()
	})
}

func requireBusy(t *testing.T, status int, code string) {
	t.Helper()

	if status != http.StatusTooManyRequests || code != "registration_busy" {
		t.Fatalf("got %d %q", status, code)
	}
}

func TestRegisterStartIsRefusedOnceTheHourlyAdmissionIsSpent(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	limitMail(t, 2)

	for range mail.Budget(mail.KindRegistration) {
		if status, _ := startRegistration(t, newEmail(), nil); status != http.StatusOK {
			t.Fatalf("status %d", status)
		}
	}

	email := newEmail()
	status, reply := startRegistration(t, email, nil)

	requireBusy(t, status, reply.Code)
	if pendingRows(t, email) != 0 || mailsTo(t, email) != 0 {
		t.Fatal("refused start left rows behind")
	}

	pending := newEmail()
	addPending(t, pending, 2*time.Minute)
	status, resent := resendVerification(t, pending)
	requireBusy(t, status, resent.Code)
}

func TestRegisterStartIsRefusedWhileAllSlotsAreBusy(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	limitMail(t, constants.DefaultMailHourlyLimit)
	release := handlers.FillRegistrationSlots()

	email := newEmail()
	status, reply := startRegistration(t, email, nil)
	requireBusy(t, status, reply.Code)
	if pendingRows(t, email) != 0 {
		t.Fatal("refused start left a row behind")
	}

	release()
	if status, _ := startRegistration(t, newEmail(), nil); status != http.StatusOK {
		t.Fatalf("after release: %d", status)
	}
}

func TestPowDifficultyRisesWithChallengeLoad(t *testing.T) {
	limitMail(t, constants.DefaultMailHourlyLimit)
	perWindow := mail.Budget(mail.KindRegistration) / 6

	var difficulty, calls int
	issue := func(n int) int {
		for ; calls < n; calls++ {
			difficulty = handlers.PowDifficulty()
		}
		return difficulty
	}

	base := constants.PowDifficultyBits
	for _, step := range []struct{ calls, want int }{
		{perWindow - 1, base},
		{perWindow, base + 1},
		{2 * perWindow, base + 2},
		{4 * perWindow, base + 3},
		{40 * perWindow, base + constants.PowMaxExtraBits},
	} {
		if got := issue(step.calls); got != step.want {
			t.Fatalf("after %d challenges: difficulty %d, want %d", step.calls, got, step.want)
		}
	}
}

func TestRegisterStartEnforcesTheDifficultyOfTheChallenge(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	limitMail(t, 2)

	c := testutil.NewClient(t)
	email := newEmail()
	status, challenge := testutil.Call[struct {
		Token      string `json:"token"`
		Difficulty int    `json:"difficulty"`
	}](c, "POST", "/auth/register/challenge", map[string]any{"email": email})
	if status != http.StatusOK || challenge.Data.Difficulty <= constants.PowDifficultyBits {
		t.Fatalf("challenge: %d %+v", status, challenge.Data)
	}

	nonce := testutil.PowNonce(t, challenge.Data.Token, func(zeros, difficulty int) bool {
		return zeros >= constants.PowDifficultyBits && zeros < difficulty
	})
	status, reply := testutil.Call[startData](c, "POST", "/auth/register/start", map[string]any{"email": email, "powToken": challenge.Data.Token, "powNonce": nonce})

	if status != http.StatusBadRequest || reply.Code != "request_verification_failed" {
		t.Fatalf("got %d %q", status, reply.Code)
	}
}
