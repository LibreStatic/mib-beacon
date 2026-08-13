const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withFinalizedMod,
} = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const RECEIVER_PACKAGE = 'com.librestatic.mibbeacon.auditreceiver';
const RECEIVER_ACTIVITY = `${RECEIVER_PACKAGE}.PngReceiverActivity`;

function withAuditDeepLinks(config) {
  return withAndroidManifest(config, (next) => {
    const application = next.modResults.manifest.application?.[0];
    const activity = application?.activity?.find((item) =>
      String(item.$?.['android:name'] ?? '').endsWith('.MainActivity'),
    );
    if (!activity) throw new Error('Could not locate generated Android MainActivity.');
    activity['intent-filter'] ??= [];
    const exactPaths = ['/__native-audit/notification', '/__native-audit/share-png'];
    for (const exactPath of exactPaths) {
      if (
        activity['intent-filter'].some((filter) =>
          filter.data?.some((data) => data.$?.['android:path'] === exactPath),
        )
      ) {
        continue;
      }
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [
          {
            $: {
              'android:scheme': 'mibbeacon',
              'android:host': 'localhost',
              'android:path': exactPath,
            },
          },
        ],
      });
    }
    return next;
  });
}

function withExactAuditDeepLinks(config) {
  return withFinalizedMod(config, [
    'android',
    async (next) => {
      const manifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(
        next.modRequest.projectRoot,
      );
      const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
      const activity = manifest.manifest.application?.[0]?.activity?.find((item) =>
        String(item.$?.['android:name'] ?? '').endsWith('.MainActivity'),
      );
      if (!activity) throw new Error('Could not locate finalized Android MainActivity.');
      const exactPaths = new Set(['/__native-audit/notification', '/__native-audit/share-png']);
      for (const filter of activity['intent-filter'] ?? []) {
        const auditData = filter.data?.find((data) => exactPaths.has(data.$?.['android:path']));
        if (!auditData) continue;
        filter.data = [
          {
            $: {
              'android:scheme': 'mibbeacon',
              'android:host': 'localhost',
              'android:path': auditData.$['android:path'],
            },
          },
        ];
      }
      await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, manifest);
      return next;
    },
  ]);
}

function withReceiverFixture(config) {
  return withDangerousMod(config, [
    'android',
    async (next) => {
      const root = next.modRequest.platformProjectRoot;
      const receiver = path.join(root, 'native-effects-audit-receiver');
      fs.mkdirSync(path.join(receiver, 'src/main/java', ...RECEIVER_PACKAGE.split('.')), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, 'settings.gradle'),
        `${fs.readFileSync(path.join(root, 'settings.gradle'), 'utf8').replace(/\ninclude ':native-effects-audit-receiver'\n/g, '\n')}\ninclude ':native-effects-audit-receiver'\n`,
      );
      fs.writeFileSync(
        path.join(receiver, 'build.gradle'),
        `apply plugin: 'com.android.application'\n\nandroid {\n  namespace '${RECEIVER_PACKAGE}'\n  compileSdk rootProject.ext.compileSdkVersion\n  defaultConfig {\n    applicationId '${RECEIVER_PACKAGE}'\n    minSdk rootProject.ext.minSdkVersion\n    targetSdk rootProject.ext.targetSdkVersion\n    versionCode 1\n    versionName '1'\n  }\n  // Test fixture only: make its release variant installable without publication secrets.\n  buildTypes {\n    release {\n      signingConfig signingConfigs.debug\n    }\n  }\n}\n`,
      );
      fs.writeFileSync(
        path.join(receiver, 'src/main/AndroidManifest.xml'),
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:theme="@style/AppTheme" android:label="MIB Beacon audit receiver"><activity android:name=".${RECEIVER_ACTIVITY.split('.').at(-1)}" android:label="MIB Beacon audit receiver" android:exported="true"><intent-filter><action android:name="android.intent.action.SEND"/><category android:name="android.intent.category.DEFAULT"/><data android:mimeType="image/png"/></intent-filter></activity></application></manifest>\n`,
      );
      fs.mkdirSync(path.join(receiver, 'src/main/res/values'), { recursive: true });
      fs.writeFileSync(
        path.join(receiver, 'src/main/res/values/styles.xml'),
        '<resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar"/></resources>\n',
      );
      fs.writeFileSync(
        path.join(
          receiver,
          'src/main/java',
          ...RECEIVER_PACKAGE.split('.'),
          'PngReceiverActivity.java',
        ),
        `package ${RECEIVER_PACKAGE};

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;

public final class PngReceiverActivity extends Activity {
  private static final String TAG = "MIBBeaconNativeAudit";
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    try {
      Intent intent = getIntent();
      if (!Intent.ACTION_SEND.equals(intent.getAction())) throw new Exception("action=" + intent.getAction());
      if (!"image/png".equals(intent.getType())) throw new Exception("mime=" + intent.getType());
      Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
      if (uri == null) throw new Exception("missing EXTRA_STREAM");
      if ((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0) throw new Exception("missing read grant flag");
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (InputStream input = getContentResolver().openInputStream(uri)) {
        if (input == null) throw new Exception("unreadable URI");
        byte[] block = new byte[4096]; int count;
        while ((count = input.read(block)) != -1) bytes.write(block, 0, count);
      }
      byte[] payload = bytes.toByteArray();
      byte[] png = new byte[] {(byte)0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
      if (payload.length < png.length) throw new Exception("short payload=" + payload.length);
      for (int i = 0; i < png.length; i++) if (payload[i] != png[i]) throw new Exception("invalid PNG signature");
      if (BitmapFactory.decodeByteArray(payload, 0, payload.length) == null) throw new Exception("PNG is not decodable");
      String name = null;
      try (Cursor cursor = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
        if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
      }
      if (!"mib-beacon-native-adapter-audit.png".equals(name)) throw new Exception("filename=" + name);
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(payload);
      StringBuilder hex = new StringBuilder(); for (byte b : digest) hex.append(String.format("%02x", b));
      Log.i(TAG, "PNG_RECEIVER_PASS action=ACTION_SEND mime=image/png filename=mib-beacon-native-adapter-audit.png bytes=" + payload.length + " sha256=" + hex + " uri=" + uri + " grant=read");
      setResult(RESULT_OK);
    } catch (Throwable error) {
      Log.e(TAG, "PNG_RECEIVER_FAIL", error);
      setResult(RESULT_CANCELED);
    } finally { finish(); }
  }
}
`,
      );
      return next;
    },
  ]);
}

module.exports = function withNativeEffectsAudit(config) {
  return withExactAuditDeepLinks(withReceiverFixture(withAuditDeepLinks(config)));
};
