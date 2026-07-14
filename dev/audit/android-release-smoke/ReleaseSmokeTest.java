package dev.mibbeacon;

import android.graphics.Rect;
import android.view.KeyEvent;
import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiScrollable;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

/** Host-driven release-APK smoke checks for the legacy device UiAutomator runner. */
public class ReleaseSmokeTest extends UiAutomatorTestCase {
  private UiObject desc(String value) {
    return new UiObject(new UiSelector().description(value));
  }

  private UiObject descStarts(String value) {
    return new UiObject(new UiSelector().descriptionStartsWith(value));
  }

  private UiObject text(String value) {
    return new UiObject(new UiSelector().text(value));
  }

  private UiObject textContains(String value) {
    return new UiObject(new UiSelector().textContains(value));
  }

  private void launch() throws Exception {
    Runtime.getRuntime()
        .exec(new String[] {"/system/bin/cmd", "statusbar", "collapse"})
        .waitFor();
    Process process =
        Runtime.getRuntime()
            .exec(
                new String[] {
                  "/system/bin/am", "start", "-n", "com.librestatic.mibbeacon/.MainActivity"
                });
    assertTrue("am start must succeed", process.waitFor() == 0);
    sleep(2500);
    getUiDevice().waitForIdle();
    assertTrue("Bottom navigation must render", desc("Traps").waitForExists(15000));
  }

  private void replace(UiObject field, String value) throws Exception {
    assertTrue("Field must render: " + field.getSelector(), field.waitForExists(5000));
    String actual = "";
    for (int attempt = 0; attempt < 3; attempt++) {
      field.click();
      getUiDevice().pressKeyCode(KeyEvent.KEYCODE_A, KeyEvent.META_CTRL_ON);
      getUiDevice().pressDelete();
      sleep(200);
      field.setText(value);
      sleep(200);
      actual = field.getText();
      if (value.equals(actual)) return;
    }
    assertTrue(
        "Field value must be exact after retries; expected " + value + " but got " + actual,
        false);
  }

  private UiObject nearestDescription(UiObject anchor, String description) throws Exception {
    Rect anchorBounds = anchor.getBounds();
    UiObject nearest = null;
    int nearestDistance = Integer.MAX_VALUE;
    for (int index = 0; index < 20; index++) {
      UiObject candidate = new UiObject(new UiSelector().description(description).instance(index));
      if (!candidate.exists()) break;
      int distance = Math.abs(candidate.getBounds().centerY() - anchorBounds.centerY());
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    assertTrue("A nearby " + description + " control must render", nearest != null);
    return nearest;
  }

  public void testColdStartAndNavigation() throws Exception {
    launch();
    for (String tab : new String[] {"Browse", "Results", "Traps", "Tools", "Settings"}) {
      assertTrue(tab + " tab must render", desc(tab).waitForExists(5000));
      desc(tab).click();
      getUiDevice().waitForIdle();
      assertTrue(tab + " tab must become selected", desc(tab).isSelected());
    }
  }

  public void testSnmpGet() throws Exception {
    launch();
    desc("Results").click();
    replace(desc("Host"), "10.0.2.2");
    replace(desc("Port"), "1611");
    getUiDevice().pressBack();
    UiScrollable list = new UiScrollable(new UiSelector().scrollable(true));
    assertTrue(
        "OID field must be reachable",
        list.scrollIntoView(new UiSelector().description("OID")));
    replace(desc("OID"), "1.3.6.1.2.1.1.1.0");
    getUiDevice().pressBack();
    assertTrue("Run Get must render", desc("Run Get").waitForExists(5000));
    desc("Run Get").click();
    sleep(2500);
    list.scrollToEnd(30);
    assertTrue(
        "SNMP Get must return the fixture sysDescr",
        textContains("spike test agent").waitForExists(15000));
  }

  public void testStreamingWalkAndCancellation() throws Exception {
    launch();
    desc("Results").click();
    UiScrollable list = new UiScrollable(new UiSelector().scrollable(true));
    list.scrollToBeginning(50);
    replace(desc("Host"), "10.0.2.2");
    replace(desc("Port"), "1611");
    getUiDevice().pressBack();
    assertTrue("Walk operation must be reachable", list.scrollIntoView(new UiSelector().description("Walk")));
    desc("Walk").click();
    assertTrue("OID field must be reachable", list.scrollIntoView(new UiSelector().description("OID")));
    replace(desc("OID"), "1.3.6.1.2.1");
    getUiDevice().pressBack();
    assertTrue("Run Walk must render", desc("Run Walk").waitForExists(5000));
    desc("Run Walk").click();
    UiObject resultTab = descStarts("Result tab 10.0.2.2 · walk · 1.3.6.1.2.1");
    assertTrue(
        "Completed walk result tab must be reachable",
        list.scrollIntoView(
            new UiSelector().descriptionStartsWith("Result tab 10.0.2.2 · walk · 1.3.6.1.2.1")));
    assertTrue(
        "Release APK must announce at least 1,000 streamed varbinds",
        resultTab
            .getContentDescription()
            .matches(".*[1-9][0-9]{3,} varbinds, [1-9][0-9]* batches, [1-9][0-9]* milliseconds"));

    list.scrollToBeginning(50);
    assertTrue("Run Walk must return after completion", desc("Run Walk").waitForExists(10000));
    replace(desc("Port"), "1612");
    getUiDevice().pressBack();
    desc("Run Walk").click();
    assertTrue("A running Android walk must expose cancellation", desc("Stop walk").waitForExists(2000));
    desc("Stop walk").click();
    assertTrue("Cancelled walk must return to idle", desc("Run Walk").waitForExists(10000));
  }

  public void testOnlineResolver() throws Exception {
    launch();
    desc("Settings").click();
    UiScrollable list = new UiScrollable(new UiSelector().scrollable(true));
    UiObject resolverSwitch =
        new UiObject(new UiSelector().className("android.widget.Switch").instance(0));
    assertTrue("Resolver switch must render", resolverSwitch.waitForExists(5000));
    assertTrue("Resolver must default off on a fresh install", !resolverSwitch.isChecked());
    resolverSwitch.click();
    assertTrue("Explicit opt-in must enable the resolver", resolverSwitch.isChecked());

    assertTrue(
        "mibbrowser.online source must be reachable",
        list.scrollIntoView(new UiSelector().text("mibbrowser.online")));
    UiObject sourceName = text("mibbrowser.online");
    nearestDescription(sourceName, "Test").click();
    assertTrue(
        "External lookup disclosure must appear before Android networking",
        text("Search configured external sources?").waitForExists(5000));
    assertTrue(
        "Disclosure must identify the contacted host",
        text("Hosts: mibbrowser.online").waitForExists(5000));
    desc("Continue").click();
    assertTrue(
        "Release APK must fetch and validate IF-MIB after explicit consent",
        textContains("Found at https://mibbrowser.online/mibs/IF-MIB.mib")
            .waitForExists(45000));

    list.scrollToBeginning(30);
    resolverSwitch = new UiObject(new UiSelector().className("android.widget.Switch").instance(0));
    assertTrue("Resolver switch must be reachable after the audit", resolverSwitch.waitForExists(5000));
    resolverSwitch.click();
    assertTrue("Resolver opt-in must be reversible", !resolverSwitch.isChecked());
  }

  public void testTrapSender() throws Exception {
    launch();
    desc("Traps").click();
    assertTrue("Send mode must render", desc("Send").waitForExists(5000));
    desc("Send").click();
    replace(desc("Host"), "10.0.2.2");
    replace(desc("Port"), "1611");
    getUiDevice().pressBack();
    assertTrue("Send trap must render", desc("Send trap").waitForExists(5000));
    desc("Send trap").click();
    assertTrue("Sender must return to idle", desc("Send trap").waitForExists(10000));
    UiScrollable list = new UiScrollable(new UiSelector().scrollable(true));
    list.scrollToEnd(30);
    assertTrue(
        "Send history must report a successful native UDP send",
        textContains("sent · 10.0.2.2:1611").waitForExists(5000));
  }

  public void testTrapReceiver() throws Exception {
    launch();
    desc("Traps").click();
    assertTrue("Receive mode must render", desc("Receive").waitForExists(5000));
    desc("Receive").click();
    UiObject stop = descStarts("Stop (");
    if (stop.exists()) {
      stop.click();
      assertTrue("Existing receiver must stop", desc("Start receiver").waitForExists(5000));
    }
    replace(desc("Listen port"), "1162");
    getUiDevice().pressBack();
    desc("udp4").click();
    desc("Start receiver").click();
    assertTrue("Receiver must bind UDP/IPv4", stop.waitForExists(10000));
    assertTrue(
        "Host-injected trap must be persisted by the release APK",
        new UiObject(new UiSelector().textMatches(".*· [1-9][0-9]* stored.*"))
            .waitForExists(45000));
    stop.click();
  }
}
