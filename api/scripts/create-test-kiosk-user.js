const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const kiosk = await prisma.kiosk.upsert({
    where: {
      deviceKey: 'RECEPTION-KIOSK-01',
    },
    update: {
      name: 'Reception Kiosk',
      location: 'Reception',
      isActive: true,
    },
    create: {
      name: 'Reception Kiosk',
      location: 'Reception',
      deviceKey: 'RECEPTION-KIOSK-01',
      isActive: true,
    },
  });

  const user = await prisma.user.upsert({
    where: {
      cardUid: 'TESTCARD001',
    },
    update: {
      fullName: 'Test Employee',
      email: null,
      passwordHash: null,
      employeeCode: 'EMP001',
      department: 'Reception',
      role: 'EMPLOYEE',
      isActive: true,
      hasMobile: false,
      authMethod: 'CARD',
      cardUid: 'TESTCARD001',
      cardAssignedAt: new Date(),
      cardDisabledAt: null,
    },
    create: {
      fullName: 'Test Employee',
      email: null,
      passwordHash: null,
      employeeCode: 'EMP001',
      department: 'Reception',
      role: 'EMPLOYEE',
      isActive: true,
      hasMobile: false,
      authMethod: 'CARD',
      cardUid: 'TESTCARD001',
      cardAssignedAt: new Date(),
      cardDisabledAt: null,
    },
  });

  console.log('Kiosk created/updated:');
  console.log(kiosk);

  console.log('User created/updated:');
  console.log(user);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
