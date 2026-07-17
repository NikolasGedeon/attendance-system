import 'location_model.dart';
import 'position_model.dart';

class UserModel {
  final String id;
  final String fullName;
  final String email;
  final String role;
  final bool isActive;
  final String? locationId;
  final LocationModel? location;
  final String? positionId;
  final PositionModel? position;
  final String employeeType; // INTERNAL | EXTERNAL
  final String? employeeCode;
  final String? department;
  final String? phoneNumber;
  final String? cardUid;
  final bool requireOtpForCard;

  const UserModel({
    required this.id,
    required this.fullName,
    required this.email,
    required this.role,
    this.isActive = true,
    this.locationId,
    this.location,
    this.positionId,
    this.position,
    this.employeeType = 'INTERNAL',
    this.employeeCode,
    this.department,
    this.phoneNumber,
    this.cardUid,
    this.requireOtpForCard = false,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      email: json['email'] as String? ?? '',
      role: json['role'] as String? ?? 'EMPLOYEE',
      isActive: json['isActive'] as bool? ?? true,
      locationId: json['locationId'] as String?,
      location: json['location'] != null
          ? LocationModel.fromJson(json['location'] as Map<String, dynamic>)
          : null,
      positionId: json['positionId'] as String?,
      position: json['position'] != null
          ? PositionModel.fromJson(json['position'] as Map<String, dynamic>)
          : null,
      employeeType: json['employeeType'] as String? ?? 'INTERNAL',
      employeeCode: json['employeeCode'] as String?,
      department: json['department'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      cardUid: json['cardUid'] as String?,
      requireOtpForCard: json['requireOtpForCard'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'fullName': fullName,
        'email': email,
        'role': role,
      };

  bool get isAdmin => role == 'ADMIN';
  bool get isManager => role == 'MANAGER';
  bool get isAdminOrManager => isAdmin || isManager;
}
