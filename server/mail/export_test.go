package mail

import gomail "github.com/wneessen/go-mail"

var (
	SendNextMail  = sendNextMail
	PurgeSentMail = purgeSentMail
)

func SetSender(f func(to, subject, body string) error) {
	send = func(to, subject, body string, _ ...gomail.ContentType) error { return f(to, subject, body) }
}

func ResetSender() {
	send = sendMail
}
