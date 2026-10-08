# acLife Client

The web and desktop app for [acLife](../README.md). One React codebase runs in the browser and, wrapped in Tauri, as a native app on Windows, Linux and macOS.

All encryption happens here. Events, settings and keys are encrypted and decrypted on your device, and the [server](../server/README.md) only ever stores ciphertext. See the [main README](../README.md#how-it-works) for how it works.

## Getting the app

- **Desktop**: download an installer from the [latest release](https://github.com/atar4xis/acLife/releases/latest). Releases are GPG-signed (see [`KEYS`](../KEYS)). The desktop app updates itself.
- **Web**: build the client yourself (below) and host the static files, or use a hosted instance.

On first launch, enter the address of the server you want to use, or choose offline mode to keep everything local on the device.

## Stack

- React 19, TypeScript and Vite
- Tailwind CSS 4 with shadcn/ui components on Radix
- Tauri 2 (Rust) for the desktop app
- Web Crypto, Argon2id (`argon2-browser`) and SRP for the cryptography
- i18next for translations, luxon for dates
- Vitest and Testing Library for tests

## Development

You need Node.js 24 and [pnpm](https://pnpm.io). A running [server](../server/README.md) is needed for anything except offline mode.

```bash
git clone https://github.com/atar4xis/acLife.git
cd acLife/client
pnpm install
pnpm dev          # http://localhost:5173
```

### Desktop app

Install [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS, then:

```bash
pnpm exec tauri dev      # run with live reload
pnpm build-tauri         # build the frontend for the desktop app
pnpm exec tauri build    # build installers into src-tauri/target/release/bundle
```

On Linux, the desktop app stores unlock PINs in the system keyring and needs a Secret Service provider such as GNOME Keyring or KWallet.

## Building the web app

```bash
pnpm build        # output in dist/
```

The web build is served from `/acLife/` by default, so host `dist/` under that path, or change `base` in [`vite.config.ts`](vite.config.ts) to serve it from the root. A strict Content Security Policy is injected into the built `index.html`. If you add an external script or resource, update the policy there and in `src-tauri/tauri.conf.json`.

The client has no environment variables. The server address is chosen in the app at runtime.

## Testing and checks

```bash
pnpm test                                       # all tests
pnpm exec vitest run tests/calendar/Calendar.recurring.test.tsx   # one file
pnpm run lint                                   # eslint, including accessibility rules
pnpm exec prettier --check src
```

Tests include accessibility checks (jest-axe). Tests run in UTC.

## Project layout

| Path | Contents |
|---|---|
| `src/App.tsx` | Provider tree: settings, theme, API, storage, user, calendar |
| `src/components/` | UI. `calendar/` is the calendar grid, editor and agenda, `settings/` the settings dialog, `ui/` the shared primitives |
| `src/context/` | React providers for the API, user and keys, storage and settings |
| `src/hooks/` | Hooks, including calendar loading, saving and sync |
| `src/lib/` | Pure logic: encryption (`crypt.ts`), recurrence, buckets, the event cache |
| `src/reducers/` | Calendar state |
| `src/locales/` | One JSON bundle per language |
| `public/themes/` | Built-in themes |
| `public/sw.js` | Service worker for push notifications |
| `src-tauri/` | Rust desktop shell |
| `tests/` | Vitest suites |

## Contributing a translation or theme

- **Language**: copy `src/locales/en.json` to `src/locales/<code>.json` and translate the values, including `meta.name` (the language's own name). Bundles are loaded automatically.
- **Theme**: add a JSON file to `public/themes/` and mirror it in `src/components/settings/builtInThemes.ts`.

## Conventions

- Import with the `@/` alias for `src/`, and build class names with `cn()` from `@/lib/utils`.
- Code in `src/` is formatted with Prettier: `pnpm exec prettier --write src`.
- No UI animations, by design: don't add transitions.
- Keep interfaces keyboard and screen-reader accessible. The lint and axe tests enforce much of this.
