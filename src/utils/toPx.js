// cache con, el for reused
var con, el
// high sample will more accurate?
var sample = 1000

function initElements () {
  con = document.createElement('div')
  con.style.position = 'absolute'
  con.style.width = 0
  con.style.height = 0
  con.style.visibility = 'hidden'
  con.style.overflow = 'hidden'
  con.style['z-index'] = -1234;
  con.style['font-family'] = 'monospace'
  con.style['font-size'] = '16px'
  el = document.createElement('div')

  con.appendChild(el)
}

function pxPerUnit (unit, element) {
  if (!con) initElements()
  el.style.width = sample + unit;
  (element || document.body).appendChild(con)
  var dimension = el.getBoundingClientRect()
  con.parentNode.removeChild(con)
  return dimension.width / sample
}

export function toPx (length, element) {
  var unitRe = /^\s*([+-]?[\d\.]*)\s*(.*)\s*$/i
  var match = unitRe.exec(length)
  if (match!=null && match.length > 2) {
    var bare = match[1] === ''
    var val = bare ? 1 : Number(match[1])
    var unit = match[2]
    var valid = !isNaN(val) && unit
  }
  if (!valid) throw new TypeError('Error parsing length')
  return unit == 'px' ? val : pxPerUnit(unit, element) * val
}

