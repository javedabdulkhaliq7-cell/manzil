package com.iqrastudy.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IqraDownloadsPlugin.class); // IQRA Scanner S9: Download to phone
        super.onCreate(savedInstanceState);
    }
}
