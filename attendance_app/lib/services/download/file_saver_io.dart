import 'dart:io';

/// Mobile/desktop implementation: writes the file to the system temp
/// directory and returns its path so the UI can show where it went.
Future<String?> saveFileBytes(
  String filename,
  List<int> bytes,
  String mimeType,
) async {
  final file = File('${Directory.systemTemp.path}${Platform.pathSeparator}$filename');
  await file.writeAsBytes(bytes, flush: true);
  return file.path;
}
