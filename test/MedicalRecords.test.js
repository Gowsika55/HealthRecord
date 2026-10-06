const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('MedicalRecords Smart Contract Architecture', function () {
  let medicalRecords;
  let deployer, personalAdminMetaMask, operator, doctor, patient, unauthorizedUser;

  beforeEach(async function () {
    [deployer, personalAdminMetaMask, operator, doctor, patient, unauthorizedUser] = await ethers.getSigners();

    const MedicalRecords = await ethers.getContractFactory('MedicalRecords');
    medicalRecords = await MedicalRecords.deploy();
    await medicalRecords.waitForDeployment();

    // Authorize operator and personal admin account
    await medicalRecords.connect(deployer).authorizeOperator(operator.address);
    await medicalRecords.connect(deployer).authorizeAdmin(personalAdminMetaMask.address);
  });

  it('Should initialize deployer as owner, admin, and operator', async function () {
    expect(await medicalRecords.owner()).to.equal(deployer.address);
    expect(await medicalRecords.isAuthorizedAdmin(deployer.address)).to.equal(true);
    expect(await medicalRecords.isAuthorizedOperator(deployer.address)).to.equal(true);
    expect(await medicalRecords.isAuthorizedAdmin(personalAdminMetaMask.address)).to.equal(true);
  });

  it('Should allow Admin Personal MetaMask to approve doctor on-chain', async function () {
    expect(await medicalRecords.approvedDoctors(doctor.address)).to.equal(false);

    await expect(medicalRecords.connect(personalAdminMetaMask).approveDoctor(doctor.address))
      .to.emit(medicalRecords, 'DoctorApproved')
      .withArgs(doctor.address, personalAdminMetaMask.address);

    expect(await medicalRecords.approvedDoctors(doctor.address)).to.equal(true);
  });

  it('Should allow Admin Personal MetaMask to revoke doctor on-chain', async function () {
    await medicalRecords.connect(personalAdminMetaMask).approveDoctor(doctor.address);
    expect(await medicalRecords.approvedDoctors(doctor.address)).to.equal(true);

    await expect(medicalRecords.connect(personalAdminMetaMask).revokeDoctor(doctor.address))
      .to.emit(medicalRecords, 'DoctorRevoked')
      .withArgs(doctor.address, personalAdminMetaMask.address);

    expect(await medicalRecords.approvedDoctors(doctor.address)).to.equal(false);
  });

  it('Should allow Admin Personal MetaMask to grant and revoke access directly', async function () {
    // Grant access via Admin MetaMask
    await expect(medicalRecords.connect(personalAdminMetaMask).grantAccess(patient.address, doctor.address))
      .to.emit(medicalRecords, 'AccessGranted')
      .withArgs(patient.address, doctor.address);

    expect(await medicalRecords.hasAccess(patient.address, doctor.address)).to.equal(true);

    // Revoke access via Admin MetaMask
    await expect(medicalRecords.connect(personalAdminMetaMask).revokeAccess(patient.address, doctor.address))
      .to.emit(medicalRecords, 'AccessRevoked')
      .withArgs(patient.address, doctor.address);

    expect(await medicalRecords.hasAccess(patient.address, doctor.address)).to.equal(false);
  });

  it('Should allow Admin Personal MetaMask to add record directly with IPFS report hash', async function () {
    await medicalRecords.connect(personalAdminMetaMask).approveDoctor(doctor.address);
    await medicalRecords.connect(personalAdminMetaMask).grantAccess(patient.address, doctor.address);

    await expect(
      medicalRecords.connect(personalAdminMetaMask).addRecord(
        doctor.address,
        patient.address,
        'Migraine',
        'Sumatriptan 50mg',
        'Take at onset',
        'Dr. House',
        'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
        '/uploads/reports/scan_report.pdf'
      )
    ).to.emit(medicalRecords, 'RecordAdded');

    const records = await medicalRecords.getRecords(patient.address);
    expect(records.length).to.equal(1);
    expect(records[0].diagnosis).to.equal('Migraine');
    expect(records[0].ipfsHash).to.equal('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco');
    expect(records[0].reportUrl).to.equal('/uploads/reports/scan_report.pdf');
  });

  it('Should allow Operator (Backend Service Wallet) to execute all actions on behalf of users', async function () {
    await medicalRecords.connect(operator).approveDoctor(doctor.address);
    await medicalRecords.connect(operator).grantAccess(patient.address, doctor.address);

    await expect(
      medicalRecords.connect(operator).addRecord(
        doctor.address,
        patient.address,
        'Hypertension Stage 1',
        'Lisinopril 10mg daily',
        'Monitor blood pressure bi-weekly',
        'Dr. Gregory House',
        'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        '/uploads/reports/lab_results.pdf'
      )
    ).to.emit(medicalRecords, 'RecordAdded');

    const records = await medicalRecords.getRecords(patient.address);
    expect(records.length).to.equal(1);
    expect(records[0].diagnosis).to.equal('Hypertension Stage 1');
    expect(records[0].ipfsHash).to.equal('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
  });

  it('Should reject unauthorized users from performing admin/operator actions', async function () {
    await expect(
      medicalRecords.connect(unauthorizedUser).approveDoctor(doctor.address)
    ).to.be.revertedWith('Caller is not authorized admin or operator');

    await expect(
      medicalRecords.connect(unauthorizedUser).grantAccess(patient.address, doctor.address)
    ).to.be.revertedWith('Caller is not authorized admin or operator');
  });
});
