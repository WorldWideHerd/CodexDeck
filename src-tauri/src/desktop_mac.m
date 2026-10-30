#import <AppKit/AppKit.h>
#import <Security/Security.h>
#include <sys/sysctl.h>
#include <stdint.h>

// Only launch the installed, signed OpenAI application. Never accept a webview path.
static NSURL *deckApplication(void) {
    for (NSString *path in @[@"/Applications/ChatGPT.app", @"/Applications/Codex.app"]) {
        NSBundle *bundle = [NSBundle bundleWithPath:path];
        if (![[bundle bundleIdentifier] isEqualToString:@"com.openai.codex"]) continue;
        SecStaticCodeRef code = NULL;
        SecRequirementRef requirement = NULL;
        NSString *rule = @"anchor apple generic and identifier \"com.openai.codex\" and certificate leaf[subject.OU] = \"2DC432GLL2\"";
        BOOL valid = SecStaticCodeCreateWithPath((__bridge CFURLRef)bundle.bundleURL, kSecCSDefaultFlags, &code) == errSecSuccess
            && SecRequirementCreateWithString((__bridge CFStringRef)rule, kSecCSDefaultFlags, &requirement) == errSecSuccess
            && SecStaticCodeCheckValidity(code, kSecCSDefaultFlags, requirement) == errSecSuccess;
        if (requirement) CFRelease(requirement);
        if (code) CFRelease(code);
        if (valid) return bundle.bundleURL;
    }
    return nil;
}
int32_t codexdeck_desktop_available(void) {
    @autoreleasepool { return deckApplication() != nil; }
}

// Read just launch paths from same-user processes, discarding all other arguments/environment.
static NSDictionary *deckPaths(pid_t pid) {
    int query[] = { CTL_KERN, KERN_PROCARGS2, pid };
    size_t size = 0;
    if (sysctl(query, 3, NULL, &size, NULL, 0) || size < sizeof(int)) return nil;
    NSMutableData *data = [NSMutableData dataWithLength:size];
    if (sysctl(query, 3, data.mutableBytes, &size, NULL, 0)) return nil;
    const char *bytes = data.bytes;
    int argc = 0;
    memcpy(&argc, bytes, sizeof(argc));
    if (argc < 1 || argc > 4096) return nil;
    size_t offset = sizeof(int);
    // executable, then NUL padding, then argc arguments, then environment strings
    size_t end = offset;
    while (end < size && bytes[end]) end++;
    if (end == size) return nil;
    offset = end + 1;
    while (offset < size && !bytes[offset]) offset++;
    NSMutableDictionary *paths = [NSMutableDictionary dictionary];
    for (int index = 0; offset < size && (index < argc || bytes[offset]); index++) {
        end = offset;
        while (end < size && bytes[end]) end++;
        if (end == size) return nil;
        if (index >= argc) {
            NSString *entry = [[NSString alloc] initWithBytes:bytes + offset length:end - offset encoding:NSUTF8StringEncoding];
            for (NSString *key in @[@"CODEX_HOME", @"CODEX_ELECTRON_USER_DATA_PATH"]) {
                NSString *prefix = [key stringByAppendingString:@"="];
                if ([entry hasPrefix:prefix]) paths[key] = [entry substringFromIndex:prefix.length];
            }
        }
        offset = end + 1;
    }
    return paths;
}

// -1 means the process could not be inspected: callers must fail closed.
static int32_t deckFind(NSString *home, NSString *userData, BOOL activate) {
    for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.openai.codex"]) {
        if (app.terminated) continue;
        NSDictionary *paths = deckPaths(app.processIdentifier);
        if (!paths) { if (app.terminated) continue; return -1; }
        NSString *activeHome = paths[@"CODEX_HOME"];
        if (!activeHome) continue;
        if (![[activeHome stringByResolvingSymlinksInPath] isEqualToString:home]) continue;
        if (userData && ![[paths[@"CODEX_ELECTRON_USER_DATA_PATH"] stringByResolvingSymlinksInPath] isEqualToString:userData]) return -1;
        if (activate && ![app activateWithOptions:NSApplicationActivateAllWindows]) return -1;
        return 1;
    }
    return 0;
}
int32_t codexdeck_desktop_active(const char *home) {
    @autoreleasepool { return deckFind([NSString stringWithUTF8String:home], nil, NO); }
}

int32_t codexdeck_original_home(uint8_t *buffer, uint32_t capacity) {
    @autoreleasepool {
        const char *home = NSHomeDirectory().UTF8String;
        if (!home || strlen(home) >= capacity) return 1;
        memcpy(buffer, home, strlen(home) + 1);
        return 0;
    }
}
