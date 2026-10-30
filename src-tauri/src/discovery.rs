use std::path::{Path, PathBuf};
pub fn executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(windows)]
    {
        path.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}
pub fn discover() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .filter(|p| p.is_absolute())
                .map(|p| p.join(name)),
        );
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        for dir in [".local/bin", ".cargo/bin", "bin", ".npm-global/bin"] {
            candidates.push(home.join(dir).join(name));
        }
        #[cfg(target_os = "macos")]
        for path in [
            "Applications/Codex.app/Contents/Resources/codex",
            "Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
            "Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
        ] {
            candidates.push(home.join(path));
        }
        #[cfg(windows)]
        {
            for dir in [".bun/bin", "scoop/shims"] {
                candidates.push(home.join(dir).join(name));
            }
        }
    }
    #[cfg(target_os = "macos")]
    for path in [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    ] {
        candidates.push(path.into());
    }
    #[cfg(target_os = "linux")]
    for path in ["/usr/local/bin/codex", "/usr/bin/codex", "/snap/bin/codex"] {
        candidates.push(path.into());
    }
    #[cfg(windows)]
    {
        let mut npm_roots = Vec::new();
        if let Some(appdata) = std::env::var_os("APPDATA") {
            npm_roots.push(PathBuf::from(appdata).join("npm/node_modules/@openai"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            npm_roots.push(PathBuf::from(local).join("npm/node_modules/@openai"));
        }
        for root in npm_roots {
            for package in ["codex", "codex-win32-x64", "codex-win32-arm64"] {
                for target in ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"] {
                    candidates.push(
                        root.join(package)
                            .join("vendor")
                            .join(target)
                            .join("codex/codex.exe"),
                    );
                    candidates.push(
                        root.join("codex/node_modules/@openai")
                            .join(package)
                            .join("vendor")
                            .join(target)
                            .join("codex/codex.exe"),
                    );
                }
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| executable(p))
        .map(|p| p.to_string_lossy().into_owned())
}
pub fn login_url(raw: &str) -> Result<url::Url, String> {
    let u =
        url::Url::parse(raw).map_err(|_| "Codex returned an invalid sign-in URL.".to_string())?;
    let host = u.host_str().unwrap_or_default();
    if u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || !(host == "auth.openai.com" || host == "chatgpt.com" || host.ends_with(".openai.com"))
    {
        return Err("Codex returned an untrusted sign-in URL.".into());
    }
    Ok(u)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_url_is_allowlisted() {
        assert!(login_url("https://auth.openai.com/oauth/authorize?state=x").is_ok());
        for url in [
            "http://auth.openai.com/",
            "https://auth.openai.com.evil.test/",
            "https://evil.test/?next=openai.com",
            "file:///etc/passwd",
            "https://user:pass@auth.openai.com/",
            "https://chatgpt.com:1234/",
        ] {
            assert!(login_url(url).is_err());
        }
    }
}
