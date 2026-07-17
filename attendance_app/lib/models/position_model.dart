class PositionModel {
  final String id;
  final String name;
  final bool isActive;

  const PositionModel({
    required this.id,
    required this.name,
    required this.isActive,
  });

  factory PositionModel.fromJson(Map<String, dynamic> json) {
    return PositionModel(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      isActive: json['isActive'] as bool? ?? true,
    );
  }
}
