#!/usr/bin/env bash
set -e

export JAVA_HOME="/Volumes/SSD/Android/jdk/Contents/Home"
export ANDROID_HOME="/Volumes/SSD/Android/sdk"
export ANDROID_SDK_ROOT="/Volumes/SSD/Android/sdk"
export ANDROID_AVD_HOME="/Volumes/SSD/Android/avd"
export ANDROID_USER_HOME="/Volumes/SSD/Android/.android"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

AVD_NAME="FamETC_Phone"

if [ "$1" = "tablet" ] || [ "$1" = "--tablet" ]; then
    AVD_NAME="FamETC_Tablet"
fi

echo "Launching Android Simulator: $AVD_NAME"
echo "Storage Location: $ANDROID_AVD_HOME/$AVD_NAME.avd"
echo "SDK Location: $ANDROID_HOME"

emulator -avd "$AVD_NAME" -gpu host
