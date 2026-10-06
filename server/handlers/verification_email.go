package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"slices"
	"strings"
)

type emailTemplate struct{ subject, body string }

// verificationEmailTemplates are keyed by base language code.
var verificationEmailTemplates = map[string]emailTemplate{
	"en": {
		subject: "Verify your email address for acLife",
		body: "Hi,\r\n\r\nPlease verify your email address for acLife using the link below:\r\n%s\r\n\r\n" +
			"This link expires in 24 hours. If you did not create an account, you can ignore this email.\r\n",
	},
	"es": {
		subject: "Verifica tu dirección de correo electrónico para acLife",
		body: "Hola,\r\n\r\nVerifica tu dirección de correo electrónico para acLife con el siguiente enlace:\r\n%s\r\n\r\n" +
			"Este enlace caduca en 24 horas. Si no has creado una cuenta, puedes ignorar este mensaje.\r\n",
	},
	"fr": {
		subject: "Vérifiez votre adresse e-mail pour acLife",
		body: "Bonjour,\r\n\r\nVeuillez vérifier votre adresse e-mail pour acLife à l'aide du lien ci-dessous :\r\n%s\r\n\r\n" +
			"Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, vous pouvez ignorer cet e-mail.\r\n",
	},
	"pl": {
		subject: "Zweryfikuj swój adres e-mail w acLife",
		body: "Cześć,\r\n\r\nZweryfikuj swój adres e-mail w acLife za pomocą poniższego linku:\r\n%s\r\n\r\n" +
			"Link wygasa za 24 godziny. Jeśli nie rozpoznajesz tej rejestracji, zignoruj tę wiadomość.\r\n",
	},
	"ja": {
		subject: "acLifeで使用するメールアドレスを確認してください",
		body: "こんにちは。\r\n\r\n以下のリンクから、acLifeで使用するメールアドレスを確認してください。\r\n%s\r\n\r\n" +
			"このリンクの有効期限は24時間です。アカウントを作成していない場合は、このメールを無視してください。\r\n",
	},
	"zh": {
		subject: "请验证您在 acLife 使用的邮箱地址",
		body: "您好，\r\n\r\n请通过以下链接验证您在 acLife 使用的邮箱地址：\r\n%s\r\n\r\n" +
			"此链接将在 24 小时后失效。如果您没有创建账户，请忽略此邮件。\r\n",
	},
	"hi": {
		subject: "acLife के लिए अपना ईमेल पता सत्यापित करें",
		body: "नमस्ते,\r\n\r\nकृपया नीचे दिए गए लिंक से acLife के लिए अपना ईमेल पता सत्यापित करें:\r\n%s\r\n\r\n" +
			"यह लिंक 24 घंटे बाद समाप्त हो जाएगा। यदि आपने खाता नहीं बनाया है, तो इस ईमेल को अनदेखा करें।\r\n",
	},
	"ar": {
		subject: "تحقق من عنوان بريدك الإلكتروني لحساب acLife",
		body: "مرحبًا،\r\n\r\nيرجى التحقق من عنوان بريدك الإلكتروني لحساب acLife عبر الرابط أدناه:\r\n%s\r\n\r\n" +
			"تنتهي صلاحية هذا الرابط بعد 24 ساعة. إذا لم تنشئ حسابًا، يمكنك تجاهل هذه الرسالة.\r\n",
	},
}

func verificationEmailLanguages() []string {
	return slices.Collect(maps.Keys(verificationEmailTemplates))
}

// verificationEmailContent builds the subject and body of a verification email for the given token in the given language.
func verificationEmailContent(token, lang string) (subject, body string) {
	return emailContent(strings.TrimRight(os.Getenv("SERVER_URL"), "/")+"/auth/verify-email?token="+token, lang)
}

func registrationEmailContent(token, email, lang string) (subject, body string) {
	payload, _ := json.Marshal(map[string]string{
		"token":  token,
		"email":  email,
		"server": strings.TrimRight(os.Getenv("SERVER_URL"), "/"),
	})
	return emailContent(os.Getenv("CLIENT_URL")+"#token="+base64.RawURLEncoding.EncodeToString(payload), lang)
}

// emailContent fills the template of lang with link, VERIFICATION_EMAIL_SUBJECT and VERIFICATION_EMAIL_BODY override the built-in text.
func emailContent(link, lang string) (subject, body string) {
	tpl, ok := verificationEmailTemplates[lang]
	if !ok {
		tpl = verificationEmailTemplates["en"]
	}

	subject = tpl.subject
	if v := os.Getenv("VERIFICATION_EMAIL_SUBJECT"); v != "" {
		subject = v
	}

	body = fmt.Sprintf(tpl.body, link)
	if v := os.Getenv("VERIFICATION_EMAIL_BODY"); v != "" {
		body = v
	}

	subject = strings.ReplaceAll(subject, "{url}", link)
	body = strings.ReplaceAll(body, "{url}", link)

	return subject, body
}
