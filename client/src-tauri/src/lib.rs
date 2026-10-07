use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

#[tauri::command]
async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    tag: String,
) -> Result<bool, String> {
    if !tag
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || ".-+_".contains(c))
    {
        return Err("invalid tag".into());
    }

    let endpoint =
        format!("https://github.com/atar4xis/acLife/releases/download/{tag}/latest.json")
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let found = update.is_some();
    *pending.inner().0.lock().unwrap() = update;
    Ok(found)
}

#[tauri::command]
async fn install_update(pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending
        .inner()
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("no pending update")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart()
}

#[cfg(not(target_os = "android"))]
static DEVICE_KEY_LOCK: Mutex<()> = Mutex::new(());

#[cfg(not(target_os = "android"))]
fn load_device_key() -> Result<Vec<u8>, String> {
    let _guard = DEVICE_KEY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let entry =
        keyring::Entry::new("com.atrxis.aclife", "device-key").map_err(|e| e.to_string())?;
    match entry.get_secret() {
        Ok(key) if key.len() == 32 => Ok(key),
        Ok(_) => Err("device key has an unexpected length".into()),
        Err(keyring::Error::NoEntry) => {
            let mut key = vec![0u8; 32];
            getrandom::fill(&mut key).map_err(|e| e.to_string())?;
            entry.set_secret(&key).map_err(|e| e.to_string())?;
            Ok(key)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(target_os = "android")]
fn load_device_key() -> Result<Vec<u8>, String> {
    Err("no system keystore on android".into())
}

#[tauri::command]
async fn device_key() -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(load_device_key)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            check_update,
            install_update,
            restart_app,
            device_key
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
