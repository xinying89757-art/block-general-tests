// The former one-off script changed existing CMS products. Fixture preparation
// is now part of the runner, which validates AUTOTEST names before any writes.
console.error('此旧脚本已停用。请使用区块运行器准备画像中的 AUTOTEST 夹具。');
process.exitCode = 1;
