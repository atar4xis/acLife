package mail

import "strings"

type provider struct {
	canonical string
	strip     string
	cutAt     string
}

var providers = func() map[string]provider {
	gmail := provider{canonical: "gmail.com", strip: ".", cutAt: "+"}
	icloud := provider{canonical: "icloud.com", cutAt: "+"}
	proton := provider{canonical: "proton.me", strip: ".-_", cutAt: "+"}
	yahoo := provider{canonical: "yahoo.com", cutAt: "-"}

	m := map[string]provider{}
	for _, d := range []string{"gmail.com", "googlemail.com"} {
		m[d] = gmail
	}
	for _, d := range []string{"icloud.com", "me.com", "mac.com"} {
		m[d] = icloud
	}
	for _, d := range []string{"proton.me", "protonmail.com", "protonmail.ch", "pm.me"} {
		m[d] = proton
	}
	for _, d := range []string{"yahoo.com", "ymail.com", "rocketmail.com"} {
		m[d] = yahoo
	}
	for _, d := range []string{"outlook.com", "hotmail.com", "live.com", "msn.com", "fastmail.com", "aol.com", "zoho.com", "tuta.com", "tutanota.com"} {
		m[d] = provider{canonical: d, cutAt: "+"}
	}
	return m
}()

func normalize(to string) (local, domain string, known bool) {
	local, domain, _ = strings.Cut(strings.ToLower(to), "@")
	p, known := providers[domain]
	if !known {
		p = provider{canonical: domain, cutAt: "+"}
	}

	if i := strings.IndexAny(local, p.cutAt); i > 0 {
		local = local[:i]
	}
	for _, c := range p.strip {
		local = strings.ReplaceAll(local, string(c), "")
	}
	return local, p.canonical, known
}
