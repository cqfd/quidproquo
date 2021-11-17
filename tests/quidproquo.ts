import * as anchor from '@project-serum/anchor';
import * as spl from '@solana/spl-token';
import { Program } from '@project-serum/anchor';
import { Quidproquo } from '../target/types/quidproquo';
import { NodeWallet } from '@project-serum/anchor/dist/cjs/provider';
import * as assert from 'assert';

describe('escrow', () => {

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace.Quidproquo as Program<Quidproquo>;

  let makerMint: spl.Token;
  let takerMint: spl.Token;
  let randomOtherMint: spl.Token;
  let offerMakersMakerTokens: anchor.web3.PublicKey;
  let offerMakersTakerTokens: anchor.web3.PublicKey;
  let offerTakersMakerTokens: anchor.web3.PublicKey;
  let offerTakersTakerTokens: anchor.web3.PublicKey;
  let offerTakersRandomOtherTokens: anchor.web3.PublicKey;
  let hackersTakerTokens: anchor.web3.PublicKey;
  const offerTaker = anchor.web3.Keypair.generate();
  const hacker = anchor.web3.Keypair.generate();

  before(async () => {
    const wallet = program.provider.wallet as NodeWallet;
    makerMint = await spl.Token.createMint(
      program.provider.connection,
      wallet.payer,
      wallet.publicKey,
      wallet.publicKey,
      0,
      spl.TOKEN_PROGRAM_ID
    );
    takerMint = await spl.Token.createMint(
      program.provider.connection,
      wallet.payer,
      wallet.publicKey,
      wallet.publicKey,
      0,
      spl.TOKEN_PROGRAM_ID
    );
    randomOtherMint = await spl.Token.createMint(
      program.provider.connection,
      wallet.payer,
      wallet.publicKey,
      wallet.publicKey,
      0,
      spl.TOKEN_PROGRAM_ID
    );
    offerMakersMakerTokens = await makerMint.createAssociatedTokenAccount(
      program.provider.wallet.publicKey
    );
    offerMakersTakerTokens = await takerMint.createAssociatedTokenAccount(
      program.provider.wallet.publicKey
    );
    offerTakersMakerTokens = await makerMint.createAssociatedTokenAccount(
      offerTaker.publicKey
    );
    offerTakersTakerTokens = await takerMint.createAssociatedTokenAccount(
      offerTaker.publicKey
    );
    offerTakersRandomOtherTokens = await randomOtherMint.createAssociatedTokenAccount(
      offerTaker.publicKey
    );
    hackersTakerTokens = await takerMint.createAssociatedTokenAccount(
      hacker.publicKey
    );

    await makerMint.mintTo(offerMakersMakerTokens, program.provider.wallet.publicKey, [], 1000);
    await takerMint.mintTo(offerTakersTakerTokens, program.provider.wallet.publicKey, [], 1000);
  });

  it("lets you make and accept offers", async () => {
    const offer = anchor.web3.Keypair.generate();

    const [escrowedMakerTokens, escrowedMakerTokensBump] = await anchor.web3.PublicKey.findProgramAddress(
      [offer.publicKey.toBuffer()],
      program.programId
    );

    await program.rpc.make(
      escrowedMakerTokensBump,
      new anchor.BN(100),
      new anchor.BN(200),
      {
        accounts: {
          offer: offer.publicKey,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersMakerTokens: offerMakersMakerTokens,
          escrowedMakerTokens: escrowedMakerTokens,
          makerMint: makerMint.publicKey,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [offer]
    });

    // Check the escrow has the right amount.
    assert.equal(100, (await makerMint.getAccountInfo(escrowedMakerTokens)).amount.toNumber());

    await program.rpc.accept({
      accounts: {
        offer: offer.publicKey,
        escrowedMakerTokens: escrowedMakerTokens,
        offerMaker: program.provider.wallet.publicKey,
        offerMakersTakerTokens: offerMakersTakerTokens,
        offerTaker: offerTaker.publicKey,
        offerTakersMakerTokens: offerTakersMakerTokens,
        offerTakersTakerTokens: offerTakersTakerTokens,
        takerMint: takerMint.publicKey,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      },
      signers: [offerTaker]
    });

    assert.equal(100, (await makerMint.getAccountInfo(offerTakersMakerTokens)).amount.toNumber());
    assert.equal(200, (await takerMint.getAccountInfo(offerMakersTakerTokens)).amount.toNumber());

    // The underlying offer account got closed when the offer got cancelled.
    assert.equal(null, await program.provider.connection.getAccountInfo(offer.publicKey));
    // The escrow account got closed when the offer got accepted.
    assert.equal(null, await program.provider.connection.getAccountInfo(escrowedMakerTokens));
  });

  it("lets you make and cancel offers", async () => {
    const offer = anchor.web3.Keypair.generate();

    const [escrowedMakerTokens, escrowedMakerTokensBump] = await anchor.web3.PublicKey.findProgramAddress(
      [offer.publicKey.toBuffer()],
      program.programId
    );

    const startingTokenBalance = (await makerMint.getAccountInfo(offerMakersMakerTokens)).amount.toNumber();

    await program.rpc.make(
      escrowedMakerTokensBump,
      new anchor.BN(100),
      new anchor.BN(200),
      {
        accounts: {
          offer: offer.publicKey,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersMakerTokens: offerMakersMakerTokens,
          escrowedMakerTokens: escrowedMakerTokens,
          makerMint: makerMint.publicKey,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [offer]
    });

    // Check the escrow has the right amount.
    assert.equal(100, (await makerMint.getAccountInfo(escrowedMakerTokens)).amount.toNumber());

    await program.rpc.cancel({
      accounts: {
        offer: offer.publicKey,
        escrowedMakerTokens: escrowedMakerTokens,
        offerMakersMakerTokens: offerMakersMakerTokens,
        offerMaker: program.provider.wallet.publicKey,
        tokenProgram: spl.TOKEN_PROGRAM_ID
      }
    });

    // The underlying offer account got closed when the offer got cancelled.
    assert.equal(null, await program.provider.connection.getAccountInfo(offer.publicKey));
    // The escrow account got closed when the offer got cancelled.
    assert.equal(null, await program.provider.connection.getAccountInfo(escrowedMakerTokens));

    // The offer maker got their tokens back.
    assert.equal(startingTokenBalance, (await makerMint.getAccountInfo(offerMakersMakerTokens)).amount.toNumber())

    // See what happens if we accept despite already canceling...
    try {
      await program.rpc.accept({
        accounts: {
          offer: offer.publicKey,
          escrowedMakerTokens: escrowedMakerTokens,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersTakerTokens: offerMakersTakerTokens,
          offerTaker: offerTaker.publicKey,
          offerTakersMakerTokens: offerTakersMakerTokens,
          offerTakersTakerTokens: offerTakersTakerTokens,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        signers: [offerTaker]
      });
      assert.fail("Accepting a previously-cancelled offer should have failed");
    } catch (e) {
      // The offer account got closed when we accepted the offer, so trying to
      // use it again results in "not owned by the program" error (as expected).
      assert.equal(0xa7, e.code);
    }
  });

  it("won't let you accept an offer with the wrong kind of tokens", async () => {
    const offer = anchor.web3.Keypair.generate();

    const [escrowedMakerTokens, escrowedMakerTokensBump] = await anchor.web3.PublicKey.findProgramAddress(
      [offer.publicKey.toBuffer()],
      program.programId
    );

    await program.rpc.make(
      escrowedMakerTokensBump,
      new anchor.BN(100),
      new anchor.BN(200),
      {
        accounts: {
          offer: offer.publicKey,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersMakerTokens: offerMakersMakerTokens,
          escrowedMakerTokens: escrowedMakerTokens,
          makerMint: makerMint.publicKey,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [offer]
    });

    // Check the escrow has the right amount.
    assert.equal(100, (await makerMint.getAccountInfo(escrowedMakerTokens)).amount.toNumber());

    try {
      await program.rpc.accept({
        accounts: {
          offer: offer.publicKey,
          escrowedMakerTokens: escrowedMakerTokens,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersTakerTokens: offerMakersTakerTokens,
          offerTaker: offerTaker.publicKey,
          offerTakersMakerTokens: offerTakersMakerTokens,
          offerTakersTakerTokens: offerTakersRandomOtherTokens,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        signers: [offerTaker]
      });
      assert.fail("Shouldn't have been able to accept an offer with the wrong type of tokens");
    } catch (e) {
      // Should trigger a constraint
      assert.equal(0x8f, e.code);
    }

    // The underlying offer account got closed when the offer got cancelled.
    assert.notEqual(null, await program.provider.connection.getAccountInfo(offer.publicKey));
    // The escrow account got closed when the offer got accepted.
    assert.notEqual(null, await program.provider.connection.getAccountInfo(escrowedMakerTokens));
  });

  it("won't let you accept an offer with the wrong amount", async () => {
    const offer = anchor.web3.Keypair.generate();

    const [escrowedMakerTokens, escrowedMakerTokensBump] = await anchor.web3.PublicKey.findProgramAddress(
      [offer.publicKey.toBuffer()],
      program.programId
    );

    await program.rpc.make(
      escrowedMakerTokensBump,
      new anchor.BN(100),
      // pick a huge amount
      new anchor.BN(10000),
      {
        accounts: {
          offer: offer.publicKey,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersMakerTokens: offerMakersMakerTokens,
          escrowedMakerTokens: escrowedMakerTokens,
          makerMint: makerMint.publicKey,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [offer]
    });

    // Check the escrow has the right amount.
    assert.equal(100, (await makerMint.getAccountInfo(escrowedMakerTokens)).amount.toNumber());

    try {
      await program.rpc.accept({
        accounts: {
          offer: offer.publicKey,
          escrowedMakerTokens: escrowedMakerTokens,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersTakerTokens: offerMakersTakerTokens,
          offerTaker: offerTaker.publicKey,
          offerTakersMakerTokens: offerTakersMakerTokens,
          offerTakersTakerTokens: offerTakersTakerTokens,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        signers: [offerTaker]
      });
      assert.fail("Shouldn't have been able to accept an offer with too few tokens");
    } catch (e) {
      assert.ok(e.logs.some(log => log.includes("insufficient funds")));
    }

    // The underlying offer account got closed when the offer got cancelled.
    assert.notEqual(null, await program.provider.connection.getAccountInfo(offer.publicKey));
    // The escrow account got closed when the offer got accepted.
    assert.notEqual(null, await program.provider.connection.getAccountInfo(escrowedMakerTokens));
  });

  it("won't let you accept an offer with a token account that doesn't belong to the maker", async () => {
    const offer = anchor.web3.Keypair.generate();

    const [escrowedMakerTokens, escrowedMakerTokensBump] = await anchor.web3.PublicKey.findProgramAddress(
      [offer.publicKey.toBuffer()],
      program.programId
    );

    await program.rpc.make(
      escrowedMakerTokensBump,
      new anchor.BN(100),
      new anchor.BN(200),
      {
        accounts: {
          offer: offer.publicKey,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersMakerTokens: offerMakersMakerTokens,
          escrowedMakerTokens: escrowedMakerTokens,
          makerMint: makerMint.publicKey,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [offer]
    });

    // Check the escrow has the right amount.
    assert.equal(100, (await makerMint.getAccountInfo(escrowedMakerTokens)).amount.toNumber());

    try {
      await program.rpc.accept({
        accounts: {
          offer: offer.publicKey,
          escrowedMakerTokens: escrowedMakerTokens,
          offerMaker: program.provider.wallet.publicKey,
          offerMakersTakerTokens: hackersTakerTokens,
          offerTaker: offerTaker.publicKey,
          offerTakersMakerTokens: offerTakersMakerTokens,
          offerTakersTakerTokens: offerTakersTakerTokens,
          takerMint: takerMint.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        signers: [offerTaker]
      });
      assert.fail("Shouldn't have been able to accept an offer with a token account that doesn't belong to the maker");
    } catch (e) {
      // Should trigger an associated token constraint
      assert.equal(0x95, e.code);
    }

    // The underlying offer account got closed when the offer got cancelled.
    assert.notEqual(null, await program.provider.connection.getAccountInfo(offer.publicKey));
    // The escrow account got closed when the offer got accepted.
    assert.notEqual(null, await program.provider.connection.getAccountInfo(escrowedMakerTokens));
  });
});
