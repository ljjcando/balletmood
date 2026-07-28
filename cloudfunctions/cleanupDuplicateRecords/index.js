const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

exports.main = async (event) => {
  const { dryRun = true } = event || {};
  const startTime = Date.now();
  const collection = db.collection('ballet_mood_records');

  try {
    const agg = await collection.aggregate()
      .group({
        _id: { o: '$_openid', d: '$dateKey' },
        cnt: $.sum(1)
      })
      .match({ cnt: _.gt(1) })
      .limit(50)
      .end();

    const pairs = agg.list || [];
    const aggTimeMs = Date.now() - startTime;
    const totalToDelete = pairs.reduce((s, p) => s + p.cnt - 1, 0);

    if (dryRun) {
      const countRes = await collection.count();
      return {
        dryRun: true, aggTimeMs,
        totalDocs: countRes.total,
        duplicatePairs: pairs.length,
        totalToDelete,
        message: `【预演】数据库共 ${countRes.total} 条，本批发现 ${pairs.length} 组重复，共 ${totalToDelete} 条待删除。确认后传 {"dryRun": false} 执行。`
      };
    }

    let deleted = 0;
    let pairsProcessed = 0;
    for (const pair of pairs) {
      if (Date.now() - startTime > 50000) break;

      const best = await collection.where({
        _openid: pair._id.o, dateKey: pair._id.d
      }).orderBy('updatedAt', 'desc').limit(1).get();

      if (!best.data || best.data.length === 0) { pairsProcessed++; continue; }

      const res = await collection.where({
        _openid: pair._id.o, dateKey: pair._id.d,
        _id: _.neq(best.data[0]._id)
      }).remove();
      deleted += res.stats.removed;
      pairsProcessed++;
    }

    const countAfter = await collection.count();
    return {
      dryRun: false,
      totalTimeMs: Date.now() - startTime,
      pairsProcessed, deleted,
      docsRemaining: countAfter.total,
      message: `【执行】处理 ${pairsProcessed} 组，删除 ${deleted} 条，剩余 ${countAfter.total} 条。${countAfter.total > 3500 ? '还有重复，请再次运行。' : '清理完成！'}`
    };
  } catch (err) {
    return { error: true, message: err.message, timeMs: Date.now() - startTime };
  }
};
