// Логика расчёта — один в один с формулами Excel-калькулятора.
//
//   H = F / C * 1000          «научная» толщина слоя материала, мм (F — коэффициент, C — плотность)
//   I = H / ΣH                доля материала в общем слое
//   J = Толщина * I           расчётная толщина материала при заданной общей толщине, мм
//   M = J * C / 1000          расход, кг/м²  (для грунта и лака — фиксированный расход)
//   N = M * Площадь           расход на площадь, кг
//   P = CEILING(N; Вес компл.) количество материала кратно комплектам, кг
//   Q = P / Вес компл.        количество комплектов
//   S = Цена * P              стоимость, руб
//   Итого = ΣS (запечатка — по желанию), за м² = Итого / Площадь
(function (root) {
  function ceilTo(value, step) {
    if (!(step > 0)) return value;
    // защита от погрешности плавающей точки: 312.0000000001 не должно становиться следующим комплектом
    return Math.ceil(value / step - 1e-9) * step;
  }

  function calculate(system, input) {
    var thickness = input.thickness;
    var area = input.area;
    var coefs = input.coefs || {};           // { "stepIdx.matIdx": число }
    var includeOptional = !!input.includeOptional;

    var sumH = 0;
    system.steps.forEach(function (step, si) {
      if (step.type !== 'layer') return;
      step.materials.forEach(function (m, mi) {
        var f = coefOf(coefs, si, mi, m);
        sumH += f / m.density * 1000;
      });
    });

    var total = 0, totalKgM2Layers = 0;
    var steps = system.steps.map(function (step, si) {
      var included = !step.optional || includeOptional;
      var rows = step.materials.map(function (m, mi) {
        var perM2;
        var coef = null;
        if (step.type === 'layer') {
          coef = coefOf(coefs, si, mi, m);
          var h = coef / m.density * 1000;
          var share = sumH > 0 ? h / sumH : 0;
          var layerMm = thickness * share;
          perM2 = layerMm * m.density / 1000;
          totalKgM2Layers += perM2;
        } else {
          perM2 = m.consumption;
        }
        var onArea = perM2 * area;
        var qty = ceilTo(onArea, m.pack);
        var packs = m.pack > 0 ? Math.round(qty / m.pack) : 0;
        var cost = m.price * qty;
        if (included) total += cost;
        return { name: m.name, kind: m.kind, coef: coef, perM2: perM2, onArea: onArea,
                 pack: m.pack, qty: qty, packs: packs, price: m.price, cost: cost };
      });
      var ratio = null;
      if (step.type === 'layer') {
        var resin = 0, filler = 0;
        rows.forEach(function (r) { if (r.kind === 'resin') resin += r.coef; else if (r.kind === 'filler') filler += r.coef; });
        ratio = resin > 0 ? filler / resin : null;
      }
      return { op: step.op, note: step.note, type: step.type, optional: !!step.optional,
               included: included, ratio: ratio, ratioMax: step.ratioMax, rows: rows };
    });

    return { steps: steps, total: total, perM2: area > 0 ? total / area : 0,
             layersKgM2: totalKgM2Layers };
  }

  function coefOf(coefs, si, mi, m) {
    var k = si + '.' + mi;
    var v = coefs[k];
    return typeof v === 'number' && isFinite(v) ? v : m.coef.value;
  }

  var api = { calculate: calculate, ceilTo: ceilTo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
