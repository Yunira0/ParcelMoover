package com.parcelmoover.rider;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.plugin.CapacitorCookies;
import com.getcapacitor.plugin.WebView;
import com.getcapacitor.plugin.SystemBars;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugins(List.<Class<? extends com.getcapacitor.Plugin>>of(
            CapacitorCookies.class,
            WebView.class,
            SystemBars.class
        ));
        super.onCreate(savedInstanceState);
    }
}
