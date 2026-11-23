package com.hifzi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Answers the presses on the recitation card's transport buttons.
 *
 * <p>A notification action cannot call into a service directly on every API level
 * this app supports, so each button is a broadcast that lands here and is forwarded
 * to the running {@link RecitationMediaService}. The buttons are:
 *
 * <ul>
 *   <li>{@code prev} / {@code next} — the <b>previous and next surah</b>, not the
 *       previous and next ayah: a memoriser listening in the car or with the phone
 *       in a pocket wants the surah to move on the way the mushaf does, ayah by ayah
 *       only inside the reader's own «التالي» controls;</li>
 *   <li>{@code play} / {@code pause} — the same toggle as the on-screen button;</li>
 *   <li>{@code stop} — ends the recitation and takes the card down.</li>
 * </ul>
 *
 * <p>The service de-duplicates a repeated action inside a short window, because a
 * user can also reach the same transport through the lock screen, a Bluetooth
 * headset or the hardware media keys — where Android may deliver the press both
 * here and to the {@code MediaSession} callback.
 */
public class RecitationMediaReceiver extends BroadcastReceiver {

    static final String EXTRA_ACTION = "recitationAction";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(EXTRA_ACTION);
        if (action == null) return;
        RecitationMediaService.dispatch(action, -1L);
    }
}
