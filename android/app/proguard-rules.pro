# Keeps the serializers kotlinx.serialization generates for the gateway's payloads.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class dev.hui.android.** { *** Companion; kotlinx.serialization.KSerializer serializer(...); }
