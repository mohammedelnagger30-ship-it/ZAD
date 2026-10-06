package com.hifzi.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) update installer: must be registered before the bridge is built.
        registerPlugin(AppUpdater.class);
        super.onCreate(savedInstanceState);
    }
}
