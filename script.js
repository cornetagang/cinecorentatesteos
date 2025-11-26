let inventoryList = [];
let html5QrCode;
let lastChecksum = "";

// ⚠️ PEGA TU URL DE APPS SCRIPT AQUÍ
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwrvQ09PpaQHw3psmr0pAVd08IdIQqgq6XxVTIledEcQHS3_KK9B_YZ120J18ugPyD7/exec";

document.addEventListener('DOMContentLoaded', () => {
    generateRandomCode();
    loadFromCloud();

    const scannerInput = document.getElementById('scannerInput');
    let timeout = null;
    scannerInput.addEventListener('input', function() {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const codigoBuscado = this.value.trim();
            if(codigoBuscado.length > 0) {
                searchAndDisplay(codigoBuscado);
            }
        }, 200); 
    });

    document.getElementById('btnScanCamera').addEventListener('click', toggleCamera);
    setupFormListeners();
});

// --- 1. FUNCIÓN PARA ACTUALIZAR LA TABLA (CON EL BOTÓN DE VENTA) ---
function updateTable() {
    const tbody = document.getElementById('inventoryTableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = "";
    
    if (inventoryList.length > 0) {
        if(emptyState) emptyState.style.display = 'none';
        
        // Invertimos para ver los nuevos arriba
        [...inventoryList].reverse().forEach((item, index) => {
            const realIndex = inventoryList.length - 1 - index;
            
            const row = `
                <tr>
                    <td class="align-middle text-center" style="width: 40px;">
                        <input type="checkbox" class="form-check-input row-checkbox fs-4" data-index="${realIndex}">
                    </td>

                    <td data-label="Producto" class="fw-bold text-start">
                        ${item["Nombre Producto"]}
                        <div class="small text-muted fw-normal">${item["Código Escaneable"]}</div>
                    </td>
                    
                    <td data-label="Precio">
                        <div class="input-group input-group-sm">
                            <span class="input-group-text border-0 bg-transparent">$</span>
                            <input type="number" class="form-control fw-bold border-0 bg-light text-end" id="edit-price-${realIndex}" value="${item["Precio"]}">
                        </div>
                    </td>
                    
                    <td data-label="Stock">
                        <input type="number" class="form-control form-control-sm text-center fw-bold border-0 bg-light" id="edit-stock-${realIndex}" value="${item["Stock"]}" style="width: 80px; margin-left:auto;">
                    </td>
                    
                    <td data-label="Acciones">
                        <div class="d-flex gap-2 justify-content-end w-100 flex-wrap">
                            <button class="btn btn-sm btn-info text-white" onclick="viewBarcode(${realIndex})" title="Ver Etiqueta">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                            
                            <button class="btn btn-sm btn-success" onclick="sellItemInCloud(${realIndex})" title="Registrar Venta">
                                <i class="fa-solid fa-dollar-sign"></i>
                            </button>

                            <button class="btn btn-sm btn-primary" onclick="updateItemInCloud(${realIndex})" title="Guardar Edición">
                                <i class="fa-solid fa-floppy-disk"></i>
                            </button>
                            
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteItemInCloud(${realIndex})" title="Borrar">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                            
                            <button class="btn btn-sm btn-outline-dark" onclick="printSingleLabel('${item["Código Escaneable"]}', '${item["Nombre Producto"]}', '${item["Descripción"]}', '${item["Unidades"]}', '${item["Tipo Código"]}')" title="Imprimir">
                                <i class="fa-solid fa-print"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    } else {
        if(emptyState) emptyState.style.display = 'block';
    }
}

// --- FUNCIÓN REGISTRAR VENTA (Llama a carga silenciosa) ---
window.sellItemInCloud = function(index) {
    const item = inventoryList[index];
    
    Swal.fire({
        title: `Vender: ${item["Nombre Producto"]}`,
        text: `Stock actual: ${item["Stock"]}`,
        input: 'number',
        inputValue: 1,
        showCancelButton: true,
        confirmButtonText: 'Confirmar Venta',
        confirmButtonColor: '#198754',
        showLoaderOnConfirm: true,
        preConfirm: (qty) => {
            if (parseInt(qty) > parseInt(item["Stock"])) { Swal.showValidationMessage(`Stock insuficiente (${item["Stock"]})`); return false; }
            return qty;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const qtyToSell = result.value;
            const dataToSend = { action: "sell", code: item["Código Escaneable"], qty: qtyToSell, name: item["Nombre Producto"], price: item["Precio"] };

            fetch(GOOGLE_SCRIPT_URL, {
                method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend)
            })
            .then(() => {
                // Notificación de éxito
                const total = qtyToSell * parseInt(item["Precio"]);
                Swal.fire({
                    icon: 'success',
                    title: 'Venta OK',
                    html: `Vendidos: <b>${qtyToSell}</b><br>Total: <b class="text-success fs-4">$${total}</b>`,
                    timer: 2000,
                    showConfirmButton: false
                });

                // ✅ AVISO DE VENTA EXITOSA Y RECARGA SILENCIOSA:
                // Forzamos la recarga de datos al instante para actualizar la tabla
                loadFromCloud(true); 
            })
            .catch(error => {
                Swal.fire('Error', 'No se pudo conectar con el servidor', 'error');
            });
        }
    });
};

// --- 3. RESTO DE FUNCIONES (SCANNER, CRUD, ETC) ---

// Seleccionar todos los checkbox
window.selectAllRows = function() {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
};

// Imprimir seleccionados
window.printSelectedLabels = function() {
    const checkboxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkboxes.length === 0) {
        Swal.fire('Nada seleccionado', 'Marca al menos un producto', 'warning');
        return;
    }
    const printWindow = window.open('', '', 'width=800,height=600');
    let htmlContent = `<html><head><title>Lote</title><style>body{font-family:Arial;padding:20px}.g{display:grid;grid-template-columns:1fr 1fr;gap:20px}.c{border:1px dashed #ccc;padding:10px;text-align:center;height:220px;display:flex;flex-direction:column;justify-content:center;align-items:center}.n{font-size:20px;font-weight:bold;margin:5px 0;text-transform:lowercase}.i{font-size:16px;font-weight:bold}svg{max-width:95%;height:80px}</style></head><body><div class="g">`;
    
    const itemsToPrint = [];
    checkboxes.forEach((cb, idx) => {
        const item = inventoryList[cb.getAttribute('data-index')];
        const units = item["Unidades"] ? `(${item["Unidades"]} u.)` : "";
        htmlContent += `<div class="c"><div class="n">${item["Nombre Producto"]}</div><div class="i">${item["Descripción"]} ${units}</div><svg id="b_${idx}"></svg></div>`;
        itemsToPrint.push({id: `b_${idx}`, code: item["Código Escaneable"], type: item["Tipo Código"]});
    });

    htmlContent += `</div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><script>window.onload=function(){const d=${JSON.stringify(itemsToPrint)};d.forEach(i=>{try{JsBarcode("#"+i.id,i.code,{format:i.type||"EAN13",width:2,height:60,displayValue:true,fontSize:16,fontOptions:"bold",margin:0})}catch(e){}});setTimeout(()=>{window.print();window.close()},1000)}<\/script></body></html>`;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
};

function calculateEAN13Checksum(code) {
    if (code.length !== 12) return "";
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        let digit = parseInt(code[i]);
        if (i % 2 === 0) sum += digit * 1; else sum += digit * 3;
    }
    let remainder = sum % 10;
    let checkDigit = (10 - remainder) % 10;
    return code + checkDigit;
}

function generateRandomCode() {
    const type = document.getElementById('codeType').value;
    let code = "";
    if (type === "EAN13") {
        let base = "780" + Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
        code = calculateEAN13Checksum(base);
    } else {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    }
    document.getElementById('prodCode').value = code;
    renderBarcode(code);
}

function renderBarcode(value) {
    if(!value) return;
    try { JsBarcode("#barcode", value, { format: document.getElementById('codeType').value, lineColor: "#000", width: 2, height: 40, displayValue: true, fontSize: 14, margin: 5, flat: true }); } catch (e) {}
}

function searchAndDisplay(code) {
    const resultBox = document.getElementById('scanResult');
    
    // Buscamos el índice en el array para poder usar las funciones de edición/venta
    const foundIndex = inventoryList.findIndex(item => String(item["Código Escaneable"]) === String(code));
    const foundItem = inventoryList[foundIndex];

    if (foundItem) {
        // 1. Llenar datos visuales
        document.getElementById('resPrice').innerText = "$" + foundItem["Precio"];
        document.getElementById('resPrice').className = "display-3 fw-bold text-success mb-0";
        document.getElementById('resName').innerText = foundItem["Nombre Producto"];
        document.getElementById('resStock').innerText = foundItem["Stock"];
        const units = foundItem["Unidades"] ? ` (${foundItem["Unidades"]} unid.)` : "";
        document.getElementById('resDesc').innerText = foundItem["Descripción"] + units;
        document.getElementById('resDesc').className = "badge bg-light text-dark fs-6";
        
        // 2. Configurar botones del verificador
        const btnSell = document.getElementById('btnQuickSell');
        const btnEdit = document.getElementById('btnQuickEdit');
        
        // Asignarles la función con el índice encontrado
        btnSell.onclick = function() { sellItemInCloud(foundIndex); };
        btnEdit.onclick = function() { 
            // Llenar formulario para editar rápido
            document.getElementById('prodName').value = foundItem["Nombre Producto"];
            document.getElementById('prodPrice').value = foundItem["Precio"];
            document.getElementById('prodStock').value = foundItem["Stock"];
            document.getElementById('prodDesc').value = foundItem["Descripción"];
            document.getElementById('prodUnits').value = foundItem["Unidades"];
            document.getElementById('codeType').value = foundItem["Tipo Código"];
            document.getElementById('prodCode').value = foundItem["Código Escaneable"];
            renderBarcode(foundItem["Código Escaneable"]);
            document.getElementById('prodName').focus();
        };

        resultBox.style.display = 'block';
        playSound('success');

        // 3. CHEQUEAR SI EL "MODO VENTA" ESTÁ ACTIVADO
        const autoSell = document.getElementById('autoSellMode').checked;
        if(autoSell) {
            sellItemInCloud(foundIndex);
        }

    } else {
        document.getElementById('resPrice').innerText = "NO REGISTRADO";
        document.getElementById('resPrice').className = "display-5 fw-bold text-danger mb-0";
        document.getElementById('resName').innerText = "Código desconocido";
        document.getElementById('resStock').innerText = "0";
        document.getElementById('resDesc').innerText = code;
        document.getElementById('resDesc').className = "badge bg-danger text-white fs-6";
        
        // Ocultar botones de acción si no existe
        document.getElementById('btnQuickSell').style.display = 'none';
        document.getElementById('btnQuickEdit').style.display = 'none';

        resultBox.style.display = 'block';
        playSound('error');
        
        // Llenar código para crearlo rápido
        document.getElementById('prodCode').value = code;
    }

    // Limpiar input
    setTimeout(() => { document.getElementById('scannerInput').value = ''; }, 3000);
}

function playSound(type) {
    const audioSrc = type === 'error' ? 'https://actions.google.com/sounds/v1/alarms/mechanical_clock_ring.ogg' : 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg';
    new Audio(audioSrc).play().catch(e => {});
}

function loadFromCloud(silent = false) {
    fetch(GOOGLE_SCRIPT_URL + "?t=" + Date.now())
        .then(r => r.json())
        .then(res => {
            // Guardar checksum
            lastChecksum = res.checksum;

            inventoryList = res.rows.map(item => ({
                "Código Escaneable": String(item.code),
                "Nombre Producto": item.name,
                "Precio": item.price,
                "Stock": item.stock,
                "Descripción": item.desc,
                "Unidades": item.units,
                "Tipo Código": item.type
            }));

            updateTable();

            if (!silent) {
                Swal.fire({
                    toast: true,
                    icon: "success",
                    title: "Inventario cargado",
                    position: "top-end",
                    timer: 1500,
                    showConfirmButton: false
                });
            }
        });
}

function setupFormListeners() {
    const nameInput = document.getElementById('prodName');
    const descInput = document.getElementById('prodDesc');
    const unitsInput = document.getElementById('prodUnits');
    nameInput.addEventListener('input', function() { document.getElementById('preview-name').textContent = this.value || "Nombre"; });
    descInput.addEventListener('input', function() { document.getElementById('preview-desc').textContent = this.value || "Medidas"; });
    unitsInput.addEventListener('input', function() { document.getElementById('preview-units').textContent = this.value ? `(${this.value} u.)` : ""; });
    document.getElementById('prodCode').addEventListener('input', function() { renderBarcode(this.value); });
    document.getElementById('btnRandom').addEventListener('click', generateRandomCode);
    document.getElementById('productForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('btnDownload').addEventListener('click', downloadExcel);
}

function handleFormSubmit(e) {
    e.preventDefault();
    const code = String(document.getElementById('prodCode').value);
    const name = document.getElementById('prodName').value;
    const price = document.getElementById('prodPrice').value;
    const stock = document.getElementById('prodStock').value;
    const desc = document.getElementById('prodDesc').value;
    const units = document.getElementById('prodUnits').value;
    const type = document.getElementById('codeType').value;
    const dataToSend = { action: "create", code, name, price, stock, desc, units, type };
    
    Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });
    fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend) })
    .then(() => {
        inventoryList.push({ "Código Escaneable": code, "Nombre Producto": name, "Precio": price, "Stock": stock, "Descripción": desc, "Unidades": units, "Tipo Código": type });
        updateTable();
        Swal.fire({ icon: 'success', title: 'Guardado', timer: 1000, showConfirmButton: false });
        e.target.reset(); generateRandomCode();
        document.getElementById('preview-name').innerText = "Nombre"; document.getElementById('preview-desc').innerText = "Medidas"; document.getElementById('preview-units').innerText = "";
    });
}

function toggleCamera() {
    const readerDiv = document.getElementById('reader');
    const btn = document.getElementById('btnScanCamera');
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            readerDiv.style.display = "none";
            btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            btn.classList.remove('btn-danger'); btn.classList.add('btn-primary');
        });
        return;
    }
    readerDiv.style.display = "block";
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    btn.classList.remove('btn-primary'); btn.classList.add('btn-danger');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } }, (t) => {
        html5QrCode.stop().then(() => {
            readerDiv.style.display = "none";
            btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
            btn.classList.remove('btn-danger'); btn.classList.add('btn-primary');
        });
        document.getElementById('scannerInput').value = t;
        searchAndDisplay(t);
    });
}

window.updateItemInCloud = function(index) {
    const item = inventoryList[index];
    const newPrice = document.getElementById(`edit-price-${index}`).value;
    const newStock = document.getElementById(`edit-stock-${index}`).value;
    const dataToSend = { action: "update", code: item["Código Escaneable"], price: newPrice, stock: newStock };
    Swal.fire({ title: 'Actualizando...', didOpen: () => Swal.showLoading() });
    fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend) })
    .then(() => { inventoryList[index]["Precio"] = newPrice; inventoryList[index]["Stock"] = newStock; Swal.fire({ icon: 'success', title: '¡Actualizado!', timer: 1000, showConfirmButton: false }); });
};

window.deleteItemInCloud = function(index) {
    const item = inventoryList[index];
    Swal.fire({ title: '¿Borrar?', text: item["Nombre Producto"], icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sí' }).then((r) => {
        if (r.isConfirmed) {
            Swal.fire({ title: 'Borrando...', didOpen: () => Swal.showLoading() });
            fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", code: item["Código Escaneable"] }) })
            .then(() => { inventoryList.splice(index, 1); updateTable(); Swal.fire('Borrado', '', 'success'); });
        }
    });
};

window.viewBarcode = function(index) {
    const item = inventoryList[index];
    document.getElementById('modalFullTitle').innerText = item["Nombre Producto"];
    document.getElementById('modalFullDesc').innerText = `${item["Descripción"]} ${item["Unidades"] ? '('+item["Unidades"]+' u.)' : ''}`;
    document.getElementById('modalProdPrice').innerText = "$" + item["Precio"];
    try { JsBarcode("#modalBarcodeSvg", item["Código Escaneable"], { format: item["Tipo Código"], lineColor: "#000", width: 3, height: 80, displayValue: true, fontSize: 18 }); } catch (e) {}
    new bootstrap.Modal(document.getElementById('viewBarcodeModal')).show();
};

window.printSingleLabel = function(code, name, desc, units, type) {
    const unitsText = units ? `(${units} unid.)` : ""; 
    const w = window.open('', '', 'width=500,height=400');
    w.document.write(`<html><head><style>body{font-family:Arial;display:flex;justify-content:center;padding-top:20px}.c{width:300px;text-align:center}.n{font-size:24px;font-weight:bold;margin-bottom:5px;text-transform:lowercase}.i{font-size:18px;font-weight:bold;margin-bottom:10px}svg{width:100%}</style></head><body><div class="c"><div class="n">${name}</div><div class="i">${desc} ${unitsText}</div><svg id="b"></svg></div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><script>JsBarcode("#b","${code}",{format:"${type||"EAN13"}",width:2.5,height:70,displayValue:true,fontSize:18,fontOptions:"bold",margin:0});window.onload=function(){setTimeout(function(){window.print();window.close()},500)}<\/script></body></html>`);
    w.document.close();
};

function downloadExcel() {
    if(inventoryList.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(inventoryList);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, "Base_Datos_Tienda.xlsx");
}

// --- SINCRONIZACIÓN AUTOMÁTICA (TIMEPO REAL) ---

// Iniciamos el "latido" del sistema: Preguntar cada 5 segundos
setInterval(syncDataBackground, 5000);

function syncDataBackground() {
    if (document.activeElement.tagName === "INPUT") return;

    fetch(GOOGLE_SCRIPT_URL + "?t=" + Date.now())
        .then(r => r.json())
        .then(res => {
            if (res.checksum !== lastChecksum) {
                lastChecksum = res.checksum;
                loadFromCloud(true);
            }
        })
        .catch(e => {});
}


// --- CARGA INICIAL DE DATOS (Acepta modo silencioso) ---
function loadFromCloud(silent = false) {
    const tbody = document.getElementById('inventoryTableBody');
    
    // Solo muestra el spinner si NO es una carga silenciosa
    if (!silent) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner-border text-primary"></div></td></tr>';
    }

    fetch(GOOGLE_SCRIPT_URL + "?t=" + Date.now())
    .then(r => r.json())
    .then(data => {
        inventoryList = [];
        data.forEach(item => {
            inventoryList.push({
                "Código Escaneable": String(item.code), "Nombre Producto": item.name, "Precio": item.price,
                "Stock": item.stock, "Descripción": item.desc, "Unidades": item.units, "Tipo Código": item.type
            });
        });
        updateTable();
        
        // Solo muestra el toast de "Cargado" en la carga inicial (no en el refresco silencioso)
        if (!silent) {
            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
            Toast.fire({ icon: 'success', title: 'Inventario Cargado' });
        }
    })
    .catch(error => {
        // Muestra error solo si no era una carga silenciosa (para no asustar al usuario)
        if (!silent) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error: No se pudo conectar a Google Sheets.</td></tr>';
        }
    });
}

// ===============
//   ABLY CLIENT
// ===============

const ably = new Ably.Realtime("r7nNxA.ExVsSw:Sob1CfbkbBuAuQNbGtzs47YlAHhvG2dTU7azbr4KeNQ");

const channel = ably.channels.get("tienda-inventario");

channel.subscribe("inventory_update", (msg) => {
    console.log("EVENTO EN TIEMPO REAL:", msg.data);

    // Llamamos a tu función de carga
    loadFromCloud(true); // <-- Refresca silenciosamente
});
