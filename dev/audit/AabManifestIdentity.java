import com.android.aapt.Resources;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Reads identity fields directly from an Android App Bundle's protobuf manifest. */
public final class AabManifestIdentity {
  public static void main(String[] args) throws Exception {
    if (args.length != 2) {
      throw new IllegalArgumentException(
          "Usage: AabManifestIdentity AndroidManifest.xml resources.pb");
    }

    var node = Resources.XmlNode.parseFrom(Files.readAllBytes(Path.of(args[0])));
    var element = node.getElement();
    if (!"manifest".equals(element.getName())) {
      throw new IllegalStateException("Expected a manifest root element");
    }

    Map<String, String> attributes = new LinkedHashMap<>();
    for (var attribute : element.getAttributeList()) {
      attributes.put(attribute.getName(), attribute.getValue());
    }

    for (String name : new String[] {"package", "versionName", "versionCode"}) {
      String value = attributes.get(name);
      if (value == null || value.isBlank()) {
        throw new IllegalStateException("Missing manifest attribute: " + name);
      }
      System.out.println(name + "=" + value);
    }

    var resources = Resources.ResourceTable.parseFrom(Files.readAllBytes(Path.of(args[1])));
    String applicationLabel = null;
    for (var resourcePackage : resources.getPackageList()) {
      for (var type : resourcePackage.getTypeList()) {
        if (!"string".equals(type.getName())) continue;
        for (var entry : type.getEntryList()) {
          if (!"app_name".equals(entry.getName())) continue;
          for (var configValue : entry.getConfigValueList()) {
            var item = configValue.getValue().getItem();
            if (item.hasStr()) {
              applicationLabel = item.getStr().getValue();
              break;
            }
          }
        }
      }
    }
    if (applicationLabel == null || applicationLabel.isBlank()) {
      throw new IllegalStateException("Missing string/app_name resource");
    }
    System.out.println("applicationLabel=" + applicationLabel);
  }
}
