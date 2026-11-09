package dev.hui.app;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * On a device: the app under test is this shell, and the Connect page's plugin is registered with it. (Instrumented
 * tests need an emulator, so CI runs the JVM unit tests; `npm run mobile -- test` is the local entry point for both.)
 */
@RunWith(AndroidJUnit4.class)
public class MainActivityInstrumentedTest {

    @Test
    public void runsAsTheShell() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("dev.hui.app.debug", appContext.getPackageName());
    }
}
