#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#import <Security/Security.h>
#include <stdint.h>
#include <stdbool.h>
typedef void (*DeckCallback)(uint64_t,int32_t);
@interface DeckNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation DeckNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    (void)center;(void)notification;
    completionHandler(UNNotificationPresentationOptionBanner|UNNotificationPresentationOptionList|UNNotificationPresentationOptionSound);
}
@end
static UNUserNotificationCenter *deckCenter(void) {
    static DeckNotificationDelegate *delegate;
    static dispatch_once_t once;
    dispatch_once(&once,^{delegate=[DeckNotificationDelegate new];});
    UNUserNotificationCenter *center=[UNUserNotificationCenter currentNotificationCenter];
    center.delegate=delegate;return center;
}
static bool packaged(void) { return [[[NSBundle mainBundle] bundlePath] hasSuffix:@".app"]; }
// Match the running process identity, not only the bundle currently on disk.
// A binary launched before signing keeps its old identity until it exits.
static bool validIdentity(void) {
    SecCodeRef code = NULL;
    CFDictionaryRef information = NULL;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return false;
    bool valid = SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information) == errSecSuccess;
    if (valid) {
        NSString *identifier = (__bridge NSString *)CFDictionaryGetValue(information, kSecCodeInfoIdentifier);
        valid = [identifier isEqualToString:[[NSBundle mainBundle] bundleIdentifier]]
            && SecCodeCheckValidity(code, kSecCSDefaultFlags, NULL) == errSecSuccess;
    }
    if (information) CFRelease(information);
    CFRelease(code);
    return valid;
}
static void status(UNNotificationSettings *s,uint64_t key,DeckCallback callback) {
    int32_t encoded=0x1000 | ((int32_t)s.authorizationStatus&7) | (((int32_t)s.alertSetting&3)<<3) | (((int32_t)s.soundSetting&3)<<5) | (((int32_t)s.alertStyle&3)<<7) | (((int32_t)s.notificationCenterSetting&3)<<9);
    callback(key,encoded);
}
void codexdeck_permission(bool request,uint64_t key,DeckCallback callback) {
    if(!packaged()) {callback(key,5);return;}
    if(!validIdentity()) {callback(key,7);return;}
    dispatch_async(dispatch_get_main_queue(),^{
        @try {
            UNUserNotificationCenter *center=deckCenter();
            [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings){
                if(request && settings.authorizationStatus==UNAuthorizationStatusNotDetermined) {
                    [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert|UNAuthorizationOptionSound completionHandler:^(BOOL granted,NSError *error){
                        (void)granted;
                        if(error){callback(key,6);return;}
                        [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *updated){status(updated,key,callback);}];
                    }];
                } else status(settings,key,callback);
            }];
        } @catch(NSException *exception){callback(key,5);}
    });
}
void codexdeck_notify(const char *title,const char *body,uint64_t key,DeckCallback callback) {
    if(!packaged()){callback(key,1);return;}
    if(!validIdentity()){callback(key,7);return;}
    NSString *titleText=[NSString stringWithUTF8String:title];
    NSString *bodyText=[NSString stringWithUTF8String:body];
    if(!titleText || !bodyText){callback(key,1);return;}
    dispatch_async(dispatch_get_main_queue(),^{
        @try {
            UNMutableNotificationContent *content=[UNMutableNotificationContent new];
            content.title=titleText;content.body=bodyText;content.sound=[UNNotificationSound defaultSound];
            UNNotificationRequest *request=[UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString] content:content trigger:nil];
            UNUserNotificationCenter *center=deckCenter();
            [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings){
                if(settings.authorizationStatus!=UNAuthorizationStatusAuthorized && settings.authorizationStatus!=UNAuthorizationStatusProvisional){callback(key,1);return;}
                [center addNotificationRequest:request withCompletionHandler:^(NSError *error){callback(key,error?1:0);}];
            }];
        } @catch(NSException *exception){callback(key,1);}
    });
}
