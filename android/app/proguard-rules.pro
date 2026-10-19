# R8 rules for the release build (minifyEnabled + shrinkResources).
#
# capacitor-android ships a *consumer* proguard file that already keeps every
# public class extending com.getcapacitor.Plugin along with its @PluginMethod /
# @PermissionCallback / @ActivityCallback members — that is what protects the
# bridge's reflective plugin loading, for bundled plugins (app, browser,
# filesystem, local-notifications) and for the app's own two plugins below.
# The explicit -keep rules here pin those two classes so a future Capacitor
# upgrade that changes the bundled rules cannot silently break in-app updates
# (AppUpdater) or the adhan overlay (AdhanOverlay).
-keep class com.hifzi.app.AppUpdater { *; }
-keep class com.hifzi.app.AdhanOverlay { *; }
# The recitation player card. The service is what the platform starts and what
# JS reaches through `RecitationMedia`, and the receiver is the target of the
# notification's own buttons — neither may be renamed or stripped.
-keep class com.hifzi.app.RecitationMedia { *; }
-keep class com.hifzi.app.RecitationMediaService { *; }
-keep class com.hifzi.app.RecitationMediaReceiver { *; }

# Capacitor's annotation lookup reads these off the kept plugin classes; R8 full
# mode (the AGP 8 default) strips annotations unless they are kept explicitly.
-keepattributes *Annotation*

# Readable stack traces from the minified build: real source file names and line
# numbers survive, which makes logcat reports from release installs debuggable
# without keeping a mapping file around.
-keepattributes SourceFile,LineNumberTable

# Manifest-declared components (MainActivity, AdhanOverlayReceiver, BootReceiver)
# are kept automatically by the AAPT-generated keep rules; no entries needed here.
#
# The Cordova compatibility layer is an empty shell in this project (no Cordova
# plugins are registered), so no org.apache.cordova.** blanket keep — letting R8
# strip the unused framework is part of the point of enabling it.
