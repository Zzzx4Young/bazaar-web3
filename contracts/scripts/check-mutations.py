"""Run deliberate regressions in /tmp copies; never mutate the shared implementation.
These are test sensitivity checks, separate from the original test-first RED logs.
"""
import pathlib, tempfile, shutil, subprocess, json, re
root=pathlib.Path(__file__).resolve().parents[1]
forge=root/'node_modules/@foundry-rs/forge-linux-amd64/bin/forge'
work=pathlib.Path(tempfile.mkdtemp(prefix='bazaar-t06-mutations-',dir='/tmp'))
mutations=[
 ('payment-deadline-inclusive','BazaarEscrow.sol','block.timestamp>=p.payDeadline','block.timestamp>p.payDeadline','testA03_paymentDeadlineMinusAtPlus'),
 ('order-funded-twice','BazaarEscrow.sol','records[p.orderId].state!=State.None || ','','testA04_revokeBeforeDepositAndDepositBeforeRevoke'),
 ('terms-not-bound','BazaarEscrow.sol','if(orderTermsHash[p.orderId]!=0 && orderTermsHash[p.orderId]!=h){revert Invalid();}','','testA04_everyFixedFieldRejectedWithValidPlatformSignature'),
 ('domain-changed','BazaarEscrow.sol','EIP712("Bazaar Testnet Escrow","1")','EIP712("Wrong escrow domain","1")','testT04_actualServiceDigestTermsAndDeposit'),
 ('first-mapping-erased','BazaarEscrow.sol','o.state=refund?State.Refunded:State.Released;','o.state=refund?State.Refunded:State.Released;if(refund)o.credentialId=0;','testA09_disputePreventsOrdinarySettlementAndFirstMappingPersists'),
 ('stock-reuse-while-funded','BazaarEscrow.sol','if(p.previousOrderId!=previous || old.state!=State.Refunded || old.credentialId!=0 || p.stockGeneration!=stockGeneration[p.stockId]+1){revert Invalid();}','','testA05_crossOrderExclusionA20_refundGenerationAndOldReplay'),
 ('deposit-reentrancy-unlocked','BazaarEscrow.sol','function deposit(PaymentPermit calldata p,bytes calldata signature) external nonReentrant','function deposit(PaymentPermit calldata p,bytes calldata signature) external','testA15_actualCallbackReentrancyBlockedAtDepositAndExit'),
 ('safe-governance-unlocked','LockedSafeGuard.sol','to != msg.sender && operation == Enum.Operation.Call','true','testA22_thresholdMembersModulesGuardFallbackCannotChange'),
]
results=[]
for name,file,old,new,test in mutations:
    run=work/name;run.mkdir()
    shutil.copytree(root/'src',run/'src');shutil.copytree(root/'test',run/'test');shutil.copytree(root/'.tmp',run/'.tmp')
    (run/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
    config=(root/'foundry.toml').read_text().replace('".tools/solc-0.8.30"',json.dumps(str(root/'.tools/solc-0.8.30')))
    (run/'foundry.toml').write_text(config)
    source=run/'src'/file;text=source.read_text()
    pattern=r'\s*'.join(re.escape(c) for c in re.sub(r'\s+','',old))
    assert len(list(re.finditer(pattern,text)))==1,(name,'source pattern changed')
    source.write_text(re.sub(pattern,lambda _:new,text))
    result=subprocess.run([str(forge),'test','--match-test',test,'-vv'],cwd=run,capture_output=True,text=True)
    log=result.stdout+result.stderr
    (root/'.tmp'/f'mutation-{name}.log').write_text(log)
    killed=result.returncode!=0 and '[FAIL:' in log and 'Compiler run failed' not in log
    results.append({'name':name,'test':test,'behaviorFailureDetected':killed,'exitCode':result.returncode})
    print(name, 'detected' if killed else 'NOT DETECTED',flush=True)
(root/'.tmp/mutations.json').write_text(json.dumps({'temporaryCopies':str(work),'results':results},indent=2)+'\n')
assert all(x['behaviorFailureDetected'] for x in results),results
