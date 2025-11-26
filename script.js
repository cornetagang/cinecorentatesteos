let inventoryList = [];
let html5QrCode;

// ⚠️ TU URL DE APPS SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzqeShO75VwdFhi2KmTxO2S8rmV6Adh4ETjBWBk4kQaDAO9Mwg5EbK_5YmUK243sCN1/exec";

document.addEventListener('DOMContentLoaded', () => {
    generateRandomCode();
    loadFromCloud();

    const scannerInput = document.getElementById('scannerInput');
    
    // Lógica del escáner
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
    
    // INICIAR SINCRONIZACIÓN AUTOMÁTICA (CADA 4 SEGUNDOS)
    setInterval(syncDataBackground, 4000);

    setupFormListeners();
});

// --- SINCRONIZACIÓN SILENCIOSA (LA CLAVE PARA QUE SE VEA EN TIEMPO REAL) ---
function syncDataBackground() {
    // 1. Verificar si el usuario está EDITANDO UN PRECIO O STOCK MANUALMENTE
    // Si está editando una fila, NO actualizamos para no borrarle lo que escribe.
    // Pero si está en el escáner (scannerInput), SÍ dejamos que actualice la tabla.
    const active = document.activeElement;
    if (active && (active.id.startsWith('edit-price') || active.id.startsWith('edit-stock'))) {
        return; // Está ocupado editando una fila, esperamos al siguiente ciclo.
    }

    // 2. Truco "?t=" + Date.now() para evitar que el navegador use memoria vieja (Caché)
    fetch(GOOGLE_SCRIPT_URL + "?t=" + Date.now())
    .then(r => r.json())
    .then(newData => {
        // Recorremos los datos de la nube
        newData.forEach(cloudItem => {
            // Buscamos el producto en nuestra memoria local
            const index = inventoryList.findIndex(i => String(i["Código Escaneable"]) === String(cloudItem.code));
            
            if (index !== -1) {
                const localItem = inventoryList[index];
                let huboCambio = false;

                // --- VERIFICAR STOCK ---
                if (String(localItem["Stock"]) !== String(cloudItem.stock)) {
                    // Actualizar memoria
                    localItem["Stock"] = cloudItem.stock;
                    
                    // Actualizar visualmente la cajita específica (Cirugía)
                    // Nota: inventoryList está en orden normal, pero visualmente puede estar invertida.
                    // Buscamos por el ID que generamos en updateTable
                    // Como updateTable usa reverse(), el ID es complejo de calcular,
                    // así que mejor buscamos todos los inputs y filtramos por el código visual si es necesario,
                    // o simplemente regeneramos la tabla si no es costoso.
                    
                    // Opción A: Actualizar directo el input si existe en el DOM
                    // El ID del input en el DOM depende de cómo se renderizó. 
                    // Para asegurar, en este caso simple, vamos a actualizar el valor del input directo.
                    // Necesitamos saber qué 'realIndex' tiene en el DOM. 
                    // Como es complicado mapearlo inverso, buscaremos el input que tenga el valor antiguo o por posición.
                    
                    // Simplificación robusta: Buscar el input por su ID lógico
                    const inputStock = document.getElementById(`edit-stock-${index}`);
                    if (inputStock) {
                        inputStock.value = cloudItem.stock;
                        inputStock.style.backgroundColor = "#fff3cd"; // Flash Amarillo
                        setTimeout(() => inputStock.style.backgroundColor = "#f8f9fa", 1000);
                    }
                    huboCambio = true;
                }

                // --- VERIFICAR PRECIO ---
                if (String(localItem["Precio"]) !== String(cloudItem.price)) {
                    localItem["Precio"] = cloudItem.price;
                    const inputPrice = document.getElementById(`edit-price-${index}`);
                    if (inputPrice) {
                        inputPrice.value = cloudItem.price;
                        inputPrice.style.backgroundColor = "#fff3cd";
                        setTimeout(() => inputPrice.style.backgroundColor = "#f8f9fa", 1000);
                    }
                    huboCambio = true;
                }

                // Si cambio algo y lo tenemos en el VISOR NEGRO, actualizarlo también
                if (huboCambio) {
                    const resName = document.getElementById('resName');
                    // Si el visor muestra este producto
                    if (resName && resName.innerText === localItem["Nombre Producto"]) {
                        document.getElementById('resStock').innerText = localItem["Stock"];
                        document.getElementById('resPrice').innerText = "$" + localItem["Precio"];
                    }
                }
            } else {
                // Si hay un producto nuevo que no teníamos, recargamos todo
                loadFromCloud();
            }
        });
    })
    .catch(e => console.error("Sync silencioso falló (normal si hay mala red)"));
}

// --- RESTO DE FUNCIONES ---

function loadFromCloud() {
    // Agregamos ?t=... también aquí para asegurar carga fresca al inicio
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
        const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
        Toast.fire({ icon: 'success', title: 'Inventario Cargado' });
    });
}

function updateTable() {
    const tbody = document.getElementById('inventoryTableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = "";
    
    if (inventoryList.length > 0) {
        if(emptyState) emptyState.style.display = 'none';
        
        // IMPORTANTE: Usamos el índice original del array para los IDs
        // Así syncDataBackground puede encontrar el input correcto `edit-stock-${index}`
        // Para mostrarlo invertido (nuevos arriba), iteramos al revés o usamos flex-reverse,
        // pero para mantener la lógica de IDs simple, renderizaremos en orden inverso manualmente
        
        const listaInvertida = [...inventoryList].map((item, index) => ({ item, index })).reverse();

        listaInvertida.forEach(({ item, index }) => {
            const row = `
                <tr>
                    <td class="align-middle text-center" style="width: 40px;">
                        <input type="checkbox" class="form-check-input row-checkbox fs-4" data-index="${index}">
                    </td>

                    <td data-label="Producto" class="fw-bold text-start">
                        ${item["Nombre Producto"]}
                        <div class="small text-muted fw-normal">${item["Código Escaneable"]}</div>
                    </td>
                    
                    <td data-label="Precio">
                        <div class="input-group input-group-sm">
                            <span class="input-group-text border-0 bg-transparent">$</span>
                            <input type="number" class="form-control fw-bold border-0 bg-light text-end" id="edit-price-${index}" value="${item["Precio"]}">
                        </div>
                    </td>
                    
                    <td data-label="Stock">
                        <input type="number" class="form-control form-control-sm text-center fw-bold border-0 bg-light" id="edit-stock-${index}" value="${item["Stock"]}" style="width: 80px; margin-left:auto;">
                    </td>
                    
                    <td data-label="Acciones">
                        <div class="d-flex gap-2 justify-content-end w-100 flex-wrap">
                            <button class="btn btn-sm btn-info text-white" onclick="viewBarcode(${index})"><i class="fa-solid fa-eye"></i></button>
                            <button class="btn btn-sm btn-success" onclick="sellItemInCloud(${index})"><i class="fa-solid fa-dollar-sign"></i></button>
                            <button class="btn btn-sm btn-primary" onclick="updateItemInCloud(${index})"><i class="fa-solid fa-floppy-disk"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteItemInCloud(${index})"><i class="fa-solid fa-trash"></i></button>
                            <button class="btn btn-sm btn-outline-dark" onclick="printSingleLabel('${item["Código Escaneable"]}', '${item["Nombre Producto"]}', '${item["Descripción"]}', '${item["Unidades"]}', '${item["Tipo Código"]}')"><i class="fa-solid fa-print"></i></button>
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

// --- FUNCIÓN VENTA RÁPIDA ---
window.sellItemInCloud = function(index) {
    const item = inventoryList[index];
    Swal.fire({
        title: `Vender: ${item["Nombre Producto"]}`,
        text: `Stock actual: ${item["Stock"]}`,
        input: 'number', inputValue: 1,
        inputAttributes: { min: 1, max: item["Stock"], step: 1 },
        showCancelButton: true, confirmButtonText: 'Vender', confirmButtonColor: '#198754',
        showLoaderOnConfirm: true,
        preConfirm: (qty) => {
            if (qty < 1) return false;
            return qty;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const qty = result.value;
            const dataToSend = {
                action: "sell", code: item["Código Escaneable"], qty: qty, 
                name: item["Nombre Producto"], price: item["Precio"]
            };
            
            fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend) })
            .then(() => {
                const newStock = parseInt(item["Stock"]) - parseInt(qty);
                inventoryList[index]["Stock"] = newStock;
                
                // Actualizar UI Inmediata
                const inputStock = document.getElementById(`edit-stock-${index}`);
                if (inputStock) inputStock.value = newStock;
                
                const resName = document.getElementById('resName');
                if (resName && resName.innerText === item["Nombre Producto"]) {
                    document.getElementById('resStock').innerText = newStock;
                }
                
                const total = qty * parseInt(item["Precio"]);
                Swal.fire({ icon: 'success', title: 'Venta OK', html: `Total: <b>$${total}</b>`, timer: 1500, showConfirmButton: false });
            });
        }
    });
};

// --- EL RESTO DE FUNCIONES ---
function searchAndDisplay(code) {
    const resultBox = document.getElementById('scanResult');
    const foundIndex = inventoryList.findIndex(item => String(item["Código Escaneable"]) === String(code));
    const foundItem = inventoryList[foundIndex];

    if (foundItem) {
        document.getElementById('resPrice').innerText = "$" + foundItem["Precio"];
        document.getElementById('resName').innerText = foundItem["Nombre Producto"];
        document.getElementById('resStock').innerText = foundItem["Stock"];
        const units = foundItem["Unidades"] ? ` (${foundItem["Unidades"]} u.)` : "";
        document.getElementById('resDesc').innerText = foundItem["Descripción"] + units;
        
        // Configurar botones del verificador
        const btnSell = document.getElementById('btnQuickSell');
        const btnEdit = document.getElementById('btnQuickEdit');
        
        // Limpiar listeners anteriores (clonando el nodo es un truco rápido)
        const newBtnSell = btnSell.cloneNode(true);
        const newBtnEdit = btnEdit.cloneNode(true);
        btnSell.parentNode.replaceChild(newBtnSell, btnSell);
        btnEdit.parentNode.replaceChild(newBtnEdit, btnEdit);

        newBtnSell.onclick = function() { sellItemInCloud(foundIndex); };
        newBtnEdit.onclick = function() { 
            // Scroll al formulario
            document.getElementById('prodName').value = foundItem["Nombre Producto"];
            document.getElementById('prodCode').value = foundItem["Código Escaneable"];
            // ... llenar resto ...
            document.getElementById('section-scan').scrollIntoView();
        };

        resultBox.style.display = 'block';
        
        // Chequear Modo Venta Automática
        const autoSell = document.getElementById('autoSellMode').checked;
        if(autoSell) {
            sellItemInCloud(foundIndex);
        }
    } else {
        // No encontrado...
        document.getElementById('resPrice').innerText = "NO REGISTRADO";
        document.getElementById('resName').innerText = "Producto desconocido";
        resultBox.style.display = 'block';
        // Llenar para crear
        document.getElementById('prodCode').value = code;
    }
    setTimeout(() => { document.getElementById('scannerInput').value = ''; }, 3000);
}

// Funciones CRUD, Barcode, etc. (Pégalos igual que antes)
window.updateItemInCloud = function(index) {
    const item = inventoryList[index];
    const newPrice = document.getElementById(`edit-price-${index}`).value;
    const newStock = document.getElementById(`edit-stock-${index}`).value;
    const data = { action: "update", code: item["Código Escaneable"], price: newPrice, stock: newStock };
    Swal.fire({title:'Guardando...', didOpen:()=>Swal.showLoading()});
    fetch(GOOGLE_SCRIPT_URL, {method:"POST", mode:"no-cors", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)})
    .then(()=>{ inventoryList[index].Precio=newPrice; inventoryList[index].Stock=newStock; Swal.fire({icon:'success', title:'Actualizado', timer:1000, showConfirmButton:false}); });
};

window.deleteItemInCloud = function(index) {
    const item = inventoryList[index];
    Swal.fire({ title: '¿Borrar?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sí' }).then((r) => {
        if (r.isConfirmed) {
            fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", code: item["Código Escaneable"] }) })
            .then(() => { inventoryList.splice(index, 1); updateTable(); Swal.fire('Borrado', '', 'success'); });
        }
    });
};

// Helpers
function calculateEAN13Checksum(code) { if (code.length !== 12) return ""; let sum = 0; for (let i = 0; i < 12; i++) { let digit = parseInt(code[i]); if (i % 2 === 0) sum += digit * 1; else sum += digit * 3; } let remainder = sum % 10; let checkDigit = (10 - remainder) % 10; return code + checkDigit; }
function generateRandomCode() { const type = document.getElementById('codeType').value; let code = ""; if (type === "EAN13") { let base = "780" + Math.floor(Math.random() * 1000000000).toString().padStart(9, "0"); code = calculateEAN13Checksum(base); } else { code = Math.floor(100000 + Math.random() * 900000).toString(); } document.getElementById('prodCode').value = code; renderBarcode(code); }
function renderBarcode(value) { if(!value) return; try { JsBarcode("#barcode", value, { format: document.getElementById('codeType').value, lineColor: "#000", width: 2, height: 40, displayValue: true, fontSize: 14, margin: 5, flat: true }); } catch (e) {} }
function setupFormListeners() { const nameInput = document.getElementById('prodName'); const descInput = document.getElementById('prodDesc'); const unitsInput = document.getElementById('prodUnits'); nameInput.addEventListener('input', function() { document.getElementById('preview-name').textContent = this.value || "Nombre"; }); descInput.addEventListener('input', function() { document.getElementById('preview-desc').textContent = this.value || "Medidas"; }); unitsInput.addEventListener('input', function() { document.getElementById('preview-units').textContent = this.value ? `(${this.value} u.)` : ""; }); document.getElementById('prodCode').addEventListener('input', function() { renderBarcode(this.value); }); document.getElementById('btnRandom').addEventListener('click', generateRandomCode); document.getElementById('productForm').addEventListener('submit', handleFormSubmit); document.getElementById('btnDownload').addEventListener('click', downloadExcel); }
function handleFormSubmit(e) { e.preventDefault(); const code = String(document.getElementById('prodCode').value); const name = document.getElementById('prodName').value; const price = document.getElementById('prodPrice').value; const stock = document.getElementById('prodStock').value; const desc = document.getElementById('prodDesc').value; const units = document.getElementById('prodUnits').value; const type = document.getElementById('codeType').value; const dataToSend = { action: "create", code, name, price, stock, desc, units, type }; Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() }); fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataToSend) }).then(() => { inventoryList.push(dataToSend); updateTable(); Swal.fire({ icon: 'success', title: 'Guardado', timer: 1000, showConfirmButton: false }); e.target.reset(); generateRandomCode(); }); }
function toggleCamera() { const readerDiv = document.getElementById('reader'); const btn = document.getElementById('btnScanCamera'); if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().then(() => { readerDiv.style.display = "none"; btn.innerHTML = '<i class="fa-solid fa-camera"></i>'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); }); return; } readerDiv.style.display = "block"; btn.innerHTML = '<i class="fa-solid fa-stop"></i>'; btn.classList.remove('btn-primary'); btn.classList.add('btn-danger'); html5QrCode = new Html5Qrcode("reader"); html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } }, (t) => { html5QrCode.stop().then(() => { readerDiv.style.display = "none"; btn.innerHTML = '<i class="fa-solid fa-camera"></i>'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); }); document.getElementById('scannerInput').value = t; searchAndDisplay(t); }); }
window.viewBarcode = function(index) { const item = inventoryList[index]; document.getElementById('modalFullTitle').innerText = item["Nombre Producto"]; document.getElementById('modalFullDesc').innerText = `${item["Descripción"]} ${item["Unidades"] ? '('+item["Unidades"]+' u.)' : ''}`; document.getElementById('modalProdPrice').innerText = "$" + item["Precio"]; try { JsBarcode("#modalBarcodeSvg", item["Código Escaneable"], { format: item["Tipo Código"], lineColor: "#000", width: 3, height: 80, displayValue: true, fontSize: 18 }); } catch (e) {} new bootstrap.Modal(document.getElementById('viewBarcodeModal')).show(); };
window.printSelectedLabels = function() { const checkboxes = document.querySelectorAll('.row-checkbox:checked'); if (checkboxes.length === 0) { Swal.fire('Nada seleccionado', '', 'warning'); return; } const printWindow = window.open('', '', 'width=800,height=600'); let htmlContent = `<html><head><title>Lote</title><style>body{font-family:Arial;padding:20px}.g{display:grid;grid-template-columns:1fr 1fr;gap:20px}.c{border:1px dashed #ccc;padding:10px;text-align:center;height:220px;display:flex;flex-direction:column;justify-content:center;align-items:center}.n{font-size:20px;font-weight:bold;margin:5px 0;text-transform:lowercase}.i{font-size:16px;font-weight:bold}svg{max-width:95%;height:80px}</style></head><body><div class="g">`; const itemsToPrint = []; checkboxes.forEach((cb, idx) => { const item = inventoryList[cb.getAttribute('data-index')]; const units = item["Unidades"] ? `(${item["Unidades"]} u.)` : ""; htmlContent += `<div class="c"><div class="n">${item["Nombre Producto"]}</div><div class="i">${item["Descripción"]} ${units}</div><svg id="b_${idx}"></svg></div>`; itemsToPrint.push({id: `b_${idx}`, code: item["Código Escaneable"], type: item["Tipo Código"]}); }); htmlContent += `</div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><script>window.onload=function(){const d=${JSON.stringify(itemsToPrint)};d.forEach(i=>{try{JsBarcode("#"+i.id,i.code,{format:i.type||"EAN13",width:2,height:60,displayValue:true,fontSize:16,fontOptions:"bold",margin:0})}catch(e){}});setTimeout(()=>{window.print();window.close()},1000)}<\/script></body></html>`; printWindow.document.write(htmlContent); printWindow.document.close(); };
window.printSingleLabel = function(code, name, desc, units, type) { const unitsText = units ? `(${units} u.)` : ""; const w = window.open('', '', 'width=500,height=400'); w.document.write(`<html><head><style>body{font-family:Arial;display:flex;justify-content:center;padding-top:20px}.c{width:300px;text-align:center}.n{font-size:24px;font-weight:bold;margin-bottom:5px;text-transform:lowercase}.i{font-size:18px;font-weight:bold;margin-bottom:10px}svg{width:100%}</style></head><body><div class="c"><div class="n">${name}</div><div class="i">${desc} ${unitsText}</div><svg id="b"></svg></div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><script>JsBarcode("#b","${code}",{format:"${type||"EAN13"}",width:2.5,height:70,displayValue:true,fontSize:18,fontOptions:"bold",margin:0});window.onload=function(){setTimeout(function(){window.print();window.close()},500)}<\/script></body></html>`); w.document.close(); };
window.selectAllRows = function() { const checkboxes = document.querySelectorAll('.row-checkbox'); const allChecked = Array.from(checkboxes).every(cb => cb.checked); checkboxes.forEach(cb => cb.checked = !allChecked); };
function downloadExcel() { if(inventoryList.length === 0) return; const ws = XLSX.utils.json_to_sheet(inventoryList); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inventario"); XLSX.writeFile(wb, "Base_Datos_Tienda.xlsx"); }
