const { ethers } = require('hardhat');
const { expect } = require('chai');
const { IdentitySDK } = require('@onchain-id/identity-sdk');
const onchainid = require('@onchain-id/solidity');

/**
 * This is an example script of how to deploy a token and interact with it.
 *
 * To run locally, first run a local node `npx hardhat node` then run
 * `npx hardhat run deploy.js --network localhost`.
 */

// NOTE: onchainid has a repo for standard claim topics https://github.com/onchain-id/claim-topics,
// although, it seems like there's been no activity in it since 2019.
const KYC = 1;

async function main() {
  // `owner` is the deployer of the contracts and the owner of the tokens.
  // `claimIssuerManager` address is the management key for the KYC trusted claim issuer.
  // `kycClaimSigner`'s address is the claim key for the KYC trusted claim issuer and is used to sign KYC claims.
  // `claimKey` address is the claim key for the identity contracts who have been KYC verified.
  // `investor1` & 2 are accounts for investors who, after KYC verification, receive & transfer some tokens.
  // `investor3` is an account for an investor who is never KYC verified.
  // `investorIdManager` address is the management key for the investors identity contracts and is used to add their claim keys.
  const [owner, otherTokenDeployer, claimIssuerManager, kycClaimSigner, claimKey, investor1, investor2, investor3, investorIdManager] =
    await ethers.getSigners();

  // First, deploy the TREX contract implementations
  console.log('Deploying TREX contract implementations');
  const trexContracts = await deployTREXContractImplementations();
  console.log('Done deploying TREX contract implementations\n');

  // Set up ImplementationAuthority to use the contract implementations just deployed
  console.log('Deploying TREXImplementationAuthority');
  const implementationAuthority = await getAndDeployContract(
    'TREXImplementationAuthority',
    true, // referenceStatus
    // The trexFactory and implementationAuthorityFactory are initialized the
    // zero address because the trexFactory needs to be deployed first.
    ethers.constants.AddressZero, // trexFactory
    ethers.constants.AddressZero, // iaFactory
  );
  const version = { major: 0, minor: 1, patch: 0 };
  await awaitTx(implementationAuthority.addAndUseTREXVersion(version, trexContracts));
  console.log('Done deploying TREXImplementationAuthority');

  console.log('Deploying IdentityRegistryStorageProxy');
  // Creating an Identity Registry Storage upfront which can be reused for all tokens.
  // NOTE: there is a hard limit of 300 Identity Registry instances that can be bound to a single Identity Registry Storage,
  // so having >300 tokens will become problematic using this single IRS approach.
  const identityRegistryStorage = await getAndDeployContract('IdentityRegistryStorageProxy', implementationAuthority.address).then(async (proxy) =>
    ethers.getContractAt('IdentityRegistryStorage', proxy.address),
  );
  console.log('Done deploying IdentityRegistryStorageProxy');

  // Deploy & setup IdFactory and TREXFactory
  console.log('Deploying IdFactory');
  const idFactory = await getAndDeployIdFactory(owner);
  const trexFactory = await getAndDeployContract('TREXFactory', implementationAuthority.address, idFactory.address);
  await awaitTx(idFactory.addTokenFactory(trexFactory.address));
  await awaitTx(implementationAuthority.setTREXFactory(trexFactory.address));
  const implementationAuthorityFactory = await getAndDeployContract('IAFactory', trexFactory.address);
  await awaitTx(implementationAuthority.setIAFactory(implementationAuthorityFactory.address));
  // The factory needs to be the owner of the Identity Registry Storage because it will bind it to the token's
  // identity registry.
  await awaitTx(identityRegistryStorage.connect(owner).transferOwnership(trexFactory.address));
  console.log('Done deploying IdFactory and TREXFactory\n');

  // Create Id & TREX gateways with their factories and grant deployment rights.
  console.log('Creating Id & TREX gateways');
  const publicDeploymentStatus = true;
  const trexGateway = await getAndDeployContract('TREXGateway', trexFactory.address, publicDeploymentStatus);
  console.log('trexGateway:', trexGateway.address);
  await awaitTx(trexGateway.addDeployer(otherTokenDeployer.address));
  await awaitTx(trexFactory.transferOwnership(trexGateway.address));

  const signersToApprove = [owner.address];
  const idGateway = await getAndDeployIdGateway(idFactory, signersToApprove);
  await awaitTx(idFactory.transferOwnership(idGateway.address));
  console.log('Done creating Id & TREX gateways\n');

  // Trusted issuers
  console.log('Setting up trusted issuers');
  const kycClaimIssuer = await getAndDeployContract('ClaimIssuer', claimIssuerManager.address);
  await awaitTx(
    kycClaimIssuer
      .connect(claimIssuerManager)
      .addKey(
        IdentitySDK.utils.encodeAndHash(['address'], [kycClaimSigner.address]),
        IdentitySDK.utils.enums.KeyPurpose.CLAIM,
        IdentitySDK.utils.enums.KeyType.ECDSA,
      ),
  );
  console.log('Done setting up trusted issuers\n');

  // Create tokens.
  console.log('Creating tokens');
  const [
    tokenAddressA,
    identityRegistryAddressA,
    _identityRegistryStorageAddressA,
    _trustedIssuerRegistryAddressA,
    _claimTopicRegistryAddressA,
    _modularComplianceRegistryAddressA,
  ] = await createToken({
    trexGateway,
    owner,
    deployer: owner,
    name: 'TokenA',
    symbol: 'TKNA',
    decimals: 2,
    irs: identityRegistryStorage,
    claimTopics: [KYC],
    issuers: [kycClaimIssuer.address],
    issuerClaims: [[KYC]],
  });
  const [
    tokenAddressB,
    _identityRegistryAddressB,
    _identityRegistryStorageAddressB,
    _trustedIssuerRegistryAddressB,
    _claimTopicRegistryAddressB,
    _modularComplianceRegistryAddressB,
  ] = await createToken({
    trexGateway,
    owner,
    deployer: otherTokenDeployer,
    name: 'TokenB',
    symbol: 'TKNB',
    decimals: 2,
    irs: identityRegistryStorage,
    claimTopics: [KYC],
    issuers: [kycClaimIssuer.address],
    issuerClaims: [[KYC]],
  });

  const tokenA = await ethers.getContractAt('Token', tokenAddressA);
  const tokenB = await ethers.getContractAt('Token', tokenAddressB);
  console.log('tokenA:', tokenA.address);
  console.log('tokenB:', tokenB.address);
  const identityRegistryA = await ethers.getContractAt('IdentityRegistry', identityRegistryAddressA);
  console.log('Done creating tokens\n');

  // Owner's identity isn't verified yet by the trusted issuers.
  console.log('Testing that owner identity is not yet verified');
  await expect(tokenA.mint(owner.address, 100)).to.be.revertedWith('Identity is not verified.');
  await expect(tokenB.mint(owner.address, 100)).to.be.revertedWith('Identity is not verified.');
  console.log('Done testing owner identity verification\n');

  // Creating identities for the users.
  // The owner is created with its address as a single management key.
  // investor1 & 2 are created with their regular addresses linked but with a separate management key
  //  that will be used to add a claim key.
  console.log('Creating identities for users');
  const ownerIdentity = await createIdentity(idGateway, owner.address);
  const investor1Identity = await createIdentityWithMgmtKey(idGateway, investor1.address, investorIdManager, owner);
  const investor2Identity = await createIdentityWithMgmtKey(idGateway, investor2.address, investorIdManager, owner);
  const investor3Identity = await createIdentityWithMgmtKey(idGateway, investor3.address, investorIdManager, owner);
  console.log('Done creating identities for users\n');

  // Add claim key to the user identities that will be used to call `addClaim`
  // on their identity contracts with a KYC verified claim.
  console.log('Adding claim keys to user identities');
  await awaitTx(
    ownerIdentity
      .connect(owner)
      .addKey(
        IdentitySDK.utils.encodeAndHash(['address'], [claimKey.address]),
        IdentitySDK.utils.enums.KeyPurpose.CLAIM,
        IdentitySDK.utils.enums.KeyType.ECDSA,
      ),
  );
  await awaitTx(
    investor1Identity
      .connect(investorIdManager)
      .addKey(
        IdentitySDK.utils.encodeAndHash(['address'], [claimKey.address]),
        IdentitySDK.utils.enums.KeyPurpose.CLAIM,
        IdentitySDK.utils.enums.KeyType.ECDSA,
      ),
  );
  await awaitTx(
    investor2Identity
      .connect(investorIdManager)
      .addKey(
        IdentitySDK.utils.encodeAndHash(['address'], [claimKey.address]),
        IdentitySDK.utils.enums.KeyPurpose.CLAIM,
        IdentitySDK.utils.enums.KeyType.ECDSA,
      ),
  );
  console.log('Done adding claim keys to user identities\n');

  // The user identities need to be registered in both tokens identity registries
  console.log('Registering identities in identity registry');
  const countryCode = 0;
  // Because both tokens use the same underlying Identity Registry Storage, this info only needs to
  // be recorded once.
  await awaitTx(identityRegistryA.registerIdentity(owner.address, ownerIdentity.address, countryCode));
  await awaitTx(identityRegistryA.registerIdentity(investor1.address, investor1Identity.address, countryCode));
  await awaitTx(identityRegistryA.registerIdentity(investor2.address, investor2Identity.address, countryCode));
  await awaitTx(identityRegistryA.registerIdentity(investor3.address, investor3Identity.address, countryCode));
  console.log('Done registering identities in identity registry\n');

  // Add KYC verified claims to the user's identities.
  console.log('Adding KYC verified claims to user identities');
  await addKYCVerifiedClaim({
    identity: ownerIdentity,
    issuer: kycClaimIssuer,
    claimSigner: kycClaimSigner,
    userClaimKey: claimKey,
  });
  await addKYCVerifiedClaim({
    identity: investor1Identity,
    issuer: kycClaimIssuer,
    claimSigner: kycClaimSigner,
    userClaimKey: claimKey,
  });
  await addKYCVerifiedClaim({
    identity: investor2Identity,
    issuer: kycClaimIssuer,
    claimSigner: kycClaimSigner,
    userClaimKey: claimKey,
  });
  console.log('Done adding KYC verified claims to user identities\n');

  // Can now mint and transfer tokens.
  console.log('Minting tokens to owner');
  await awaitTx(tokenA.mint(owner.address, 1000));
  await awaitTx(tokenB.mint(owner.address, 500));
  console.log('Done minting tokens to owner\n');

  console.log('Testing that investors cannot mint tokens');
  await expect(tokenA.connect(investor1).mint(investor1.address, 100)).to.be.revertedWith('AgentRole: caller does not have the Agent role');
  await expect(tokenB.connect(investor2).mint(investor2.address, 100)).to.be.revertedWith('AgentRole: caller does not have the Agent role');
  console.log('Done testing investor mint restrictions\n');

  console.log('Unpausing tokens');
  await awaitTx(tokenA.unpause());
  await awaitTx(tokenB.unpause());
  console.log('Done unpausing tokens\n');

  console.log('Testing token transfers');
  await awaitTx(tokenA.connect(owner).transfer(investor1.address, 500));
  await awaitTx(tokenA.connect(investor1).transfer(investor2.address, 250));
  await awaitTx(tokenA.connect(investor2).transfer(owner.address, 125));
  await awaitTx(tokenB.connect(owner).transfer(investor1.address, 200));
  // investor3's identity is never verified, so these fail.
  await expect(tokenA.connect(owner).transfer(investor3.address, 1)).to.be.revertedWith('Transfer not possible');
  console.log('Done testing token transfers\n');

  console.log('Verifying final token balances');
  expect(await tokenA.balanceOf(owner.address)).to.be.equal(625);
  expect(await tokenA.balanceOf(investor1.address)).to.be.equal(250);
  expect(await tokenA.balanceOf(investor2.address)).to.be.equal(125);
  expect(await tokenB.balanceOf(owner.address)).to.be.equal(300);
  expect(await tokenB.balanceOf(investor1.address)).to.be.equal(200);
  expect(await tokenB.balanceOf(investor2.address)).to.be.equal(0);
  console.log('Done verifying final token balances\n');

  console.log('Done');
}

async function createToken({ trexGateway, owner, deployer, name, symbol, decimals, irs, claimTopics, issuers, issuerClaims }) {
  const tokenDetails = {
    owner: owner.address,
    name,
    symbol,
    decimals,
    irs: irs.address,
    // Leaving as zero address so that factory will create it
    ONCHAINID: ethers.constants.AddressZero,
    irAgents: [owner.address],
    tokenAgents: [owner.address],
    complianceModules: [],
    complianceSettings: [],
  };
  const claimDetails = {
    claimTopics,
    issuers,
    issuerClaims,
  };
  const tx = await trexGateway.connect(deployer).deployTREXSuite(tokenDetails, claimDetails, {
    gasLimit: 10_000_000,
  });
  const receipt = await tx.wait();
  const trexFactoryAddress = await trexGateway.getFactory();
  const trexFactory = await ethers.getContractAt('TREXFactory', trexFactoryAddress);
  const filter = trexFactory.filters.TREXSuiteDeployed();
  const events = await trexFactory.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
  const deployedEvent = events.find((e) => e.event === 'TREXSuiteDeployed');
  return deployedEvent.args;
}

// `identity` is the identity contract instance of the user who has just undergone KYC successfully.
// `issuer` is the claim issuer contract instance of the claim issuer.
// `claimSigner` is a claim/management key of the claim issuer, which has already been added to its claim issuer contract.
// `userClaimKey` is a claim/management key of the user who owns the identity which has already been added
// to its identity contract.
async function addKYCVerifiedClaim({ identity, issuer, claimSigner, userClaimKey }) {
  const claimTopic = KYC;
  const scheme = IdentitySDK.utils.enums.KeyType.ECDSA;
  const issuerAddress = issuer.address;
  const identityAddress = identity.address;
  const claimData = ethers.utils.hexlify(ethers.utils.toUtf8Bytes('user is KYC verified'));
  const uri = '';
  const hashToSign = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bytes'], [identityAddress, claimTopic, claimData]),
  );
  const signature = await claimSigner.signMessage(ethers.utils.arrayify(hashToSign));
  await awaitTx(identity.connect(userClaimKey).addClaim(claimTopic, scheme, issuerAddress, signature, claimData, uri));
}

async function createIdentity(idGateway, walletAddress) {
  const tx = await idGateway.deployIdentityForWallet(walletAddress, {
    gasLimit: 10_000_000,
  });
  const receipt = await tx.wait();
  const idFactoryAddress = await idGateway.idFactory();
  const idFactory = await ethers.getContractAt(onchainid.contracts.Factory.abi, idFactoryAddress);
  const filter = idFactory.filters.WalletLinked();
  const events = await idFactory.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
  const idAddress = events.find((e) => e.event === 'WalletLinked').args.identity;
  return ethers.getContractAt('Identity', idAddress);
}

async function createIdentityWithMgmtKey(idGateway, walletAddress, managerSigner, approver) {
  const mgmtKey = IdentitySDK.utils.encodeAndHash(['address'], [managerSigner.address]);
  const identityOwner = walletAddress;
  // Using the wallet address as the salt
  const salt = walletAddress;
  const mgmtKeys = [mgmtKey];
  // Never expires.
  const signatureExpiry = 0;
  const hashToSign = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['string', 'address', 'string', 'bytes32[]', 'uint256'],
      ['Authorize ONCHAINID deployment', identityOwner, salt, mgmtKeys, signatureExpiry],
    ),
  );
  const signature = await approver.signMessage(ethers.utils.arrayify(hashToSign));
  const tx = await idGateway.deployIdentityWithSaltAndManagementKeys(identityOwner, salt, mgmtKeys, signatureExpiry, signature, {
    gasLimit: 10_000_000,
  });
  const receipt = await tx.wait();
  const idFactoryAddress = await idGateway.idFactory();
  const idFactory = await ethers.getContractAt(onchainid.contracts.Factory.abi, idFactoryAddress);
  const filter = idFactory.filters.WalletLinked();
  const events = await idFactory.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
  const idAddress = events.find((e) => e.event === 'WalletLinked').args.identity;
  return ethers.getContractAt('Identity', idAddress);
}

async function deployTREXContractImplementations() {
  console.log('Deploying TrustedIssuersRegistry');
  const trustedIssuersRegistryImplementation = await getAndDeployContract('TrustedIssuersRegistry');
  console.log('Deploying ClaimTopicsRegistry');
  const claimTopicsRegistryImplementation = await getAndDeployContract('ClaimTopicsRegistry');
  console.log('Deploying Token');
  const tokenImplementation = await getAndDeployContract('Token');
  console.log('Deploying IdentityRegistry');
  const identityRegistryImplementation = await getAndDeployContract('IdentityRegistry');
  console.log('Deploying IdentityRegistryStorage');
  const identityRegistryStorageImplementation = await getAndDeployContract('IdentityRegistryStorage');
  console.log('Deploying ModularCompliance');
  const modularComplianceImplementation = await getAndDeployContract('ModularCompliance');

  return {
    tokenImplementation: tokenImplementation.address,
    ctrImplementation: claimTopicsRegistryImplementation.address,
    irImplementation: identityRegistryImplementation.address,
    irsImplementation: identityRegistryStorageImplementation.address,
    tirImplementation: trustedIssuersRegistryImplementation.address,
    mcImplementation: modularComplianceImplementation.address,
  };
}

async function getAndDeployIdFactory(owner) {
  const identityImplementation = await getAndDeployContract('Identity', owner.address, true);
  const identityImplementationAuthority = await getAndDeployContract('ImplementationAuthority', identityImplementation.address);
  const idFactoryArtifact = onchainid.contracts.Factory;
  const contractFactory = await ethers.getContractFactory(idFactoryArtifact.abi, idFactoryArtifact.bytecode);
  const idFactory = await contractFactory.deploy(identityImplementationAuthority.address, {
    gasLimit: 10_000_000,
  });
  await idFactory.deployed();
  return idFactory;
}

async function getAndDeployIdGateway(idFactory, signersToApprove) {
  const idGatewayArtifact = onchainid.contracts.Gateway;
  const contractFactory = await ethers.getContractFactory(idGatewayArtifact.abi, idGatewayArtifact.bytecode);
  const idGateway = await contractFactory.deploy(idFactory.address, signersToApprove, {
    gasLimit: 10_000_000,
  });
  await idGateway.deployed();
  return idGateway;
}

async function getAndDeployContract(s, ...initArgs) {
  const contractFactory = await ethers.getContractFactory(s);
  const contract = await contractFactory.deploy(...initArgs, {
    gasLimit: 10_000_000,
  });
  await contract.deployed();
  return contract;
}

async function awaitTx(tx) {
  const txResp = await tx;
  return txResp.wait();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
