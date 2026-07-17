// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;

/// Web implementation: triggers a browser download via a Blob + anchor.
/// Returns null (the browser handles where the file goes).
Future<String?> saveFileBytes(
  String filename,
  List<int> bytes,
  String mimeType,
) async {
  final blob = html.Blob([bytes], mimeType);
  final url = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: url)..download = filename;
  html.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  html.Url.revokeObjectUrl(url);
  return null;
}
