"use strict";

document.addEventListener('DOMContentLoaded', () => {

    // ========== CONFIGURACIÓN DE FIREBASE ==========
const firebaseConfig = {
  apiKey: "AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8",
  authDomain: "sistemaintegrall.firebaseapp.com",
  projectId: "sistemaintegrall",
  storageBucket: "sistemaintegrall.firebasestorage.app",
  messagingSenderId: "302291844621",
  appId: "1:302291844621:web:6ebf1845790bdeabfc1f44",
  measurementId: "G-E5BT7GXRZN"
};

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    
    const auth = firebase.auth();
    const db = firebase.firestore();

    // ========== ESTADO Y ELEMENTOS DEL DOM ==========
    const AppState = {
        adminUIDs: ["wz4A81Vp8tQIjzVXMANmOHUlsNH2", "8NfEfPSyusZdNUFgXWPtvi3p6Ns1"],
        allUsers: [], 
        filteredUsers: [], 
        allBosses: [],
        editUserModal: null,
        selectedUserUIDs: new Set(), // Este set SOLO contendrá usuarios si 'Seleccionar todos' está marcado.
                                     // No se llenará con selecciones individuales para activar la barra.
    };

    const UIElements = {
        adminPanel: document.getElementById("admin-panel-container"),
        notAdminMsg: document.getElementById("notAdminMsg"),
        userCardsContainer: document.getElementById("user-cards-container"),
        logoutBtn: document.getElementById("logout-btn"),
        searchFilter: document.getElementById("search-filter"),
        selectAllUsersCheckbox: document.getElementById('select-all-users'), 
        bulkActionsBar: document.getElementById('bulk-actions-bar'), 
        selectedCountSpan: document.getElementById('selected-count'), // El contador de usuarios seleccionados.
        bulkStatusSelect: document.getElementById('bulk-status-select'), 
        bulkRoleSelect: document.getElementById('bulk-role-select'), 
        bulkBossSelect: document.getElementById('bulk-boss-select'), 
        bulkStoreInput: document.getElementById('bulk-store-input'), 
        bulkDepartmentInput: document.getElementById('bulk-department-input'), 
        bulkApplyBtn: document.getElementById('bulk-apply-btn'), 
        modal: {
            el: document.getElementById('editUserModal'),
            uid: document.getElementById('edit-user-uid'),
            avatar: document.getElementById('modal-avatar'),
            name: document.getElementById('modal-user-name'), 
            email: document.getElementById('modal-user-email'), 
            statusSelect: document.getElementById('modal-status-select'),
            roleSelect: document.getElementById('modal-role-select'),
            bossSelect: document.getElementById('modal-boss-select'),
            storeInput: document.getElementById('modal-store-input'), 
            departmentInput: document.getElementById('modal-department-input'), 
            saveBtn: document.getElementById('modal-save-btn'),
            deleteBtn: document.getElementById('modal-delete-btn'),
            deleteConfirmInput: document.getElementById('delete-confirm-input')
        }
    };

    // ========== INICIALIZACIÓN DE LA APLICACIÓN ==========
    if (UIElements.modal.el) {
        AppState.editUserModal = new bootstrap.Modal(UIElements.modal.el);
    }

    auth.onAuthStateChanged(handleAuthChange);

    async function handleAuthChange(user) {
        if (user && AppState.adminUIDs.includes(user.uid)) {
            await initializeAdminPanel();
        } else {
            showNotAdmin();
        }
    }

    async function initializeAdminPanel() {
        UIElements.adminPanel.style.display = 'block';
        showSkeletonLoader();
        await loadAllBosses();
        populateBulkBosses();
        await loadAllUsers();
        initEventListeners();
        
        // ***** CRUCIAL: Asegura que la barra esté oculta y el checkbox "Seleccionar todos" desmarcado al inicio. *****
        UIElements.bulkActionsBar.classList.remove('show');
        if (UIElements.selectAllUsersCheckbox) {
            UIElements.selectAllUsersCheckbox.checked = false;
            UIElements.selectAllUsersCheckbox.indeterminate = false;
        }
        AppState.selectedUserUIDs.clear(); // Limpia la lista de UIDs para acciones masivas.
        UIElements.selectedCountSpan.textContent = '0'; // Asegura que el contador esté en 0.
    }

    function showNotAdmin() {
        if (UIElements.userCardsContainer) UIElements.userCardsContainer.innerHTML = '';
        if (UIElements.notAdminMsg) UIElements.notAdminMsg.style.display = 'block';
        if (UIElements.adminPanel) UIElements.adminPanel.style.display = 'none';
    }

    function showSkeletonLoader() {
        if (!UIElements.userCardsContainer) return;
        UIElements.userCardsContainer.innerHTML = Array(5).fill('').map(() => `
            <div class="skeleton-card">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-text">
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line short"></div>
                </div>
            </div>`
        ).join('');
    }

    // ========== LÓGICA DE DATOS ==========
    async function loadAllBosses() {
        try {
            const snapshot = await db.collection("usuarios").where("role", "==", "jefe").get();
            AppState.allBosses = snapshot.docs.map(doc => {
                const data = doc.data();
                const bossName = data.displayName || data.name || data.nombre || data.email;
                return { uid: doc.id, name: bossName };
            });
        } catch (error) { 
            console.error("Error al cargar la lista de jefes:", error); 
            Swal.fire('Error', 'No se pudo cargar la lista de jefes.', 'error');
        }
    }

    function populateBulkBosses() {
        if (!UIElements.bulkBossSelect) return;
        UIElements.bulkBossSelect.innerHTML = '<option value="">-- Asignar Jefe --</option>' + AppState.allBosses.map(boss =>
            `<option value="${boss.uid}">${boss.name}</option>`
        ).join('');
    }

    async function loadAllUsers() {
        try {
            const snapshot = await db.collection("usuarios").orderBy("createdAt", "desc").get();
            AppState.allUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
            AppState.filteredUsers = [...AppState.allUsers];
            renderUserCards(AppState.filteredUsers);
        } catch (error) {
            console.error("Error al obtener usuarios:", error);
            Swal.fire('Error', 'No se pudieron cargar los datos de los usuarios.', 'error');
        }
    }

    // ========== RENDERIZADO DE LA INTERFAZ ==========
    function renderUserCards(users) {
        const container = UIElements.userCardsContainer;
        if (!container) return; 
        
        container.innerHTML = users.length === 0 
            ? `<p class="text-center text-muted mt-4">No se encontraron usuarios.</p>`
            : users.map(createUserCardHTML).join('');

        // Al renderizar, los checkboxes individuales y la clase 'selected'
        // deben reflejar el estado actual de AppState.selectedUserUIDs.
        // Si AppState.selectedUserUIDs está vacío (que es el estado normal si "Seleccionar todos" no está activo),
        // entonces nada se marcará.
        document.querySelectorAll('.user-card').forEach(card => {
            const uid = card.dataset.uid;
            const checkbox = card.querySelector('.user-checkbox');
            if (AppState.selectedUserUIDs.has(uid)) {
                card.classList.add('selected');
                if (checkbox) checkbox.checked = true;
            } else {
                card.classList.remove('selected');
                if (checkbox) checkbox.checked = false;
            }
        });
        
        updateBulkActionsBarVisibility(); // Actualiza la visibilidad de la barra.
        updateSelectAllCheckboxState(); // Actualiza el checkbox "Seleccionar todos".
    }

    function createUserCardHTML(user) {
        const name = user.displayName || user.name || user.nombre || user.email.split('@')[0];
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        const registrationDate = user.createdAt?.toDate()
            ? user.createdAt.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
            : 'N/A';

        const status = user.status || 'pendiente';
        const bossName = AppState.allBosses.find(b => b.uid === user.jefeAsignado)?.name || 'Sin asignar';

        const actionsHTML = status === 'aprobado' ? `
            <button class="actions-btn edit-user-btn" title="Editar Usuario"><i class="bi bi-three-dots-vertical"></i></button>
        ` : `
            <div class="action-buttons-pending">
                <button class="btn-action btn-reject reject-btn" title="Rechazar"><i class="bi bi-x-lg"></i></button>
                <button class="btn-action btn-approve approve-btn" title="Aprobar"><i class="bi bi-check-lg"></i></button>
            </div>
        `;

        const isSelectedClass = AppState.selectedUserUIDs.has(user.uid) ? 'selected' : '';
        const isCheckedAttribute = AppState.selectedUserUIDs.has(user.uid) ? 'checked' : '';


        return `
        <div class="user-card status-${status} ${isSelectedClass}" data-uid="${user.uid}">
            <input type="checkbox" class="user-checkbox" ${isCheckedAttribute}>
            <div class="user-main-info">
                <div class="user-avatar">${initials}</div>
                <div class="user-name-email">
                    <span class="name">${name}</span>
                    <span class="email">${user.email}</span>
                    <div class="user-id" title="${user.uid}">ID: ${user.uid.substring(0,8)}...<i class="bi bi-clipboard-check-fill copy-uid-btn" title="Copiar ID"></i></div>
                </div>
            </div>
            <div class="user-details">
                <span class="user-meta-item" title="Tienda"><i class="bi bi-shop"></i><strong>${user.store || 'N/A'}</strong></span>
                <span class="user-meta-item" title="Departamento"><i class="bi bi-person-vcard"></i><strong>${user.department || 'N/A'}</strong></span>
                <span class="user-meta-item" title="Fecha de Registro"><i class="bi bi-calendar-check"></i><strong>${registrationDate}</strong></span>
            </div>
            <div class="user-status-roles">
                <span class="status-badge ${status}">${status}</span>
                <small class="text-muted mt-1">Rol: <strong>${user.role || 'N/A'}</strong></small>
                <small class="text-muted">Jefe: <strong>${bossName}</strong></small>
            </div>
            <div class="user-actions">${actionsHTML}</div>
        </div>`;
    }

    // ========== MANEJO DE EVENTOS Y ACCIONES ==========
    function initEventListeners() {
        if(UIElements.logoutBtn) UIElements.logoutBtn.addEventListener("click", () => auth.signOut());
        if(UIElements.searchFilter) UIElements.searchFilter.addEventListener("input", handleFilter);
        
        if(UIElements.userCardsContainer) UIElements.userCardsContainer.addEventListener('click', e => {
            const card = e.target.closest('.user-card');
            if (!card) return; 
            const uid = card.dataset.uid;

            if (e.target.closest('.approve-btn')) {
                updateUserStatus(uid, 'aprobado');
            } else if (e.target.closest('.reject-btn')) {
                updateUserStatus(uid, 'rechazado');
            } 
            else if (e.target.closest('.edit-user-btn')) {
                openEditModal(uid);
            } 
            else if (e.target.closest('.copy-uid-btn')) {
                copyToClipboard(uid, e.target);
            }
            // ***** CAMBIO CLAVE: CÓMO LOS CHECKBOXES INDIVIDUALES AFECTAN LA SELECCIÓN *****
            // Los checkboxes individuales ahora SÓLO afectan el AppState.selectedUserUIDs y el estado del 'Seleccionar todos'.
            // NO activan la barra de acciones masivas por sí mismos.
            if (e.target.classList.contains('user-checkbox')) {
                if (e.target.checked) {
                    AppState.selectedUserUIDs.add(uid);
                    card.classList.add('selected'); // Marcar visualmente la tarjeta
                } else {
                    AppState.selectedUserUIDs.delete(uid);
                    card.classList.remove('selected'); // Desmarcar visualmente la tarjeta
                }
                updateSelectAllCheckboxState(); // Recalcula el estado de 'Seleccionar todos' (incluyendo indeterminado)
                updateBulkActionsBarVisibility(); // Vuelve a evaluar la visibilidad de la barra
            }
        });

        // Listener para el checkbox "Seleccionar todos".
        if(UIElements.selectAllUsersCheckbox) {
            UIElements.selectAllUsersCheckbox.addEventListener('change', (e) => {
                toggleSelectAll(e.target.checked); 
            });
        }

        // Listener para el botón "Aplicar" de acciones masivas.
        if(UIElements.bulkApplyBtn) {
            UIElements.bulkApplyBtn.addEventListener('click', applyBulkActions);
        }

        if(UIElements.modal.saveBtn) UIElements.modal.saveBtn.addEventListener('click', saveUserChanges);
        if(UIElements.modal.deleteConfirmInput) UIElements.modal.deleteConfirmInput.addEventListener('input', validateDelete);
        if(UIElements.modal.deleteBtn) UIElements.modal.deleteBtn.addEventListener('click', () => {
            const uid = UIElements.modal.uid.value;
            AppState.editUserModal.hide();
            removeUser(uid);
        });
    }

    function handleFilter() {
        const filterValue = UIElements.searchFilter.value.trim().toLowerCase();
        AppState.filteredUsers = AppState.allUsers.filter(user =>
            Object.values(user).some(val => 
                (typeof val === 'string' && val.toLowerCase().includes(filterValue)) ||
                (user.email && user.email.toLowerCase().includes(filterValue)) ||
                (user.displayName && user.displayName.toLowerCase().includes(filterValue)) ||
                (user.name && user.name.toLowerCase().includes(filterValue)) ||
                (user.nombre && user.nombre.toLowerCase().includes(filterValue)) ||
                (user.store && String(user.store).toLowerCase().includes(filterValue)) || 
                (user.department && String(user.department).toLowerCase().includes(filterValue)) 
            )
        );
        
        // Al filtrar, necesitamos actualizar AppState.selectedUserUIDs para que solo contenga los usuarios
        // que todavía están visibles Y estaban seleccionados (si 'Seleccionar todos' estaba activo).
        // Si 'Seleccionar todos' no estaba activo, el AppState.selectedUserUIDs ya estará vacío.
        const previousSelected = new Set(AppState.selectedUserUIDs); // Guarda los previamente seleccionados
        AppState.selectedUserUIDs.clear(); // Limpia el set
        
        AppState.filteredUsers.forEach(user => {
            if (previousSelected.has(user.uid)) {
                AppState.selectedUserUIDs.add(user.uid); // Si estaba seleccionado y sigue visible, lo mantenemos
            }
        });

        renderUserCards(AppState.filteredUsers); 
        // updateBulkActionsBarVisibility y updateSelectAllCheckboxState se llaman desde renderUserCards
    }

    function openEditModal(uid) {
        const user = AppState.allUsers.find(u => u.uid === uid);
        if (!user) return;
        
        const name = user.displayName || user.name || user.nombre || user.email.split('@')[0];
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        UIElements.modal.uid.value = uid;
        UIElements.modal.avatar.textContent = initials;
        UIElements.modal.name.textContent = name; 
        UIElements.modal.email.textContent = user.email; 

        UIElements.modal.statusSelect.innerHTML = `
            <option value="aprobado" ${user.status === 'aprobado' ? 'selected' : ''}>Aprobado</option>
            <option value="pendiente" ${user.status === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="rechazado" ${user.status === 'rechazado' ? 'selected' : ''}>Rechazado</option>
        `;
        UIElements.modal.roleSelect.innerHTML = `
            <option value="vendedor" ${user.role === 'vendedor' ? 'selected' : ''}>Vendedor</option>
            <option value="auxiliar" ${user.role === 'auxiliar' ? 'selected' : ''}>Auxiliar</option>
            <option value="jefe" ${user.role === 'jefe' ? 'selected' : ''}>Jefe</option>
        `;
        UIElements.modal.bossSelect.innerHTML = '<option value="">-- Sin Asignar --</option>' + AppState.allBosses.map(boss => 
            `<option value="${boss.uid}" ${user.jefeAsignado === boss.uid ? 'selected' : ''}>${boss.name}</option>`
        ).join('');

        UIElements.modal.storeInput.value = user.store || '';
        UIElements.modal.departmentInput.value = user.department || '';
        
        UIElements.modal.deleteConfirmInput.value = '';
        UIElements.modal.deleteBtn.disabled = true;

        AppState.editUserModal.show();
    }

    function validateDelete() {
        const user = AppState.allUsers.find(u => u.uid === UIElements.modal.uid.value);
        if (!user) return;
        UIElements.modal.deleteBtn.disabled = UIElements.modal.deleteConfirmInput.value.toLowerCase() !== user.email.toLowerCase();
    }

    async function saveUserChanges() {
        const saveBtn = UIElements.modal.saveBtn;
        const spinner = saveBtn.querySelector('.spinner-border');
        spinner.style.display = 'inline-block'; 
        saveBtn.disabled = true; 

        const uid = UIElements.modal.uid.value;
        const dataToUpdate = {
            status: UIElements.modal.statusSelect.value,
            role: UIElements.modal.roleSelect.value,
            jefeAsignado: UIElements.modal.bossSelect.value || null,
            store: UIElements.modal.storeInput.value.trim() || null, 
            department: UIElements.modal.departmentInput.value.trim() || null, 
        };

        try {
            await db.collection("usuarios").doc(uid).update(dataToUpdate); 
            AppState.editUserModal.hide(); 
            Swal.fire({ icon: "success", title: "Cambios Guardados", timer: 1500, showConfirmButton: false });
            
            const userIndexAll = AppState.allUsers.findIndex(u => u.uid === uid);
            if (userIndexAll > -1) Object.assign(AppState.allUsers[userIndexAll], dataToUpdate);
            const userIndexFiltered = AppState.filteredUsers.findIndex(u => u.uid === uid);
            if (userIndexFiltered > -1) Object.assign(AppState.filteredUsers[userIndexFiltered], dataToUpdate);
            
            renderUserCards(AppState.filteredUsers); 
        } catch (error) {
            console.error("Error al actualizar usuario:", error);
            Swal.fire("Error", "No se pudo actualizar el usuario.", "error");
        } finally {
            spinner.style.display = 'none'; 
            saveBtn.disabled = false; 
        }
    }

    async function updateUserStatus(uid, status) {
        try {
            await db.collection("usuarios").doc(uid).update({ status }); 
            Swal.fire({ icon: "success", title: `Usuario ${status}`, timer: 1500, showConfirmButton: false });
            
            const userIndexAll = AppState.allUsers.findIndex(u => u.uid === uid);
            if (userIndexAll > -1) AppState.allUsers[userIndexAll].status = status;
            const userIndexFiltered = AppState.filteredUsers.findIndex(u => u.uid === uid);
            if (userIndexFiltered > -1) AppState.filteredUsers[userIndexFiltered].status = status;
            
            renderUserCards(AppState.filteredUsers); 
        } catch (error) { 
            console.error("Error al cambiar estado:", error);
            Swal.fire("Error", `No se pudo cambiar el estado.`, "error"); 
        }
    }

    async function removeUser(uid) {
        try {
            await db.collection("usuarios").doc(uid).delete(); 
            Swal.fire({ icon: "success", title: "Eliminado", text: "El usuario ha sido eliminado.", timer: 2000, showConfirmButton: false });
            
            AppState.allUsers = AppState.allUsers.filter(u => u.uid !== uid);
            AppState.filteredUsers = AppState.filteredUsers.filter(u => u.uid !== uid);
            AppState.selectedUserUIDs.delete(uid); 
            renderUserCards(AppState.filteredUsers); 
        } catch (error) { 
            console.error("Error al eliminar usuario:", error);
            Swal.fire("Error", "No se pudo eliminar el usuario.", "error"); 
        }
    }

    function copyToClipboard(text, element) {
        if (!navigator.clipboard) {
            Swal.fire('Error', 'Tu navegador no es compatible con la función de copiado.', 'error');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            const originalIcon = element.className;
            element.className = 'bi bi-check-lg text-success'; 
            setTimeout(() => { element.className = originalIcon; }, 1500); 
        }).catch(err => {
            console.error('Error al copiar texto: ', err);
            Swal.fire('Error', 'No se pudo copiar. Asegúrate de usar la página en un entorno seguro (https o localhost).', 'error');
        });
    }

    // ========== LÓGICA DE SELECCIÓN MASIVA (AJUSTE FINAL) ==========

    // Esta función maneja la lógica cuando el checkbox "Seleccionar todos" cambia.
    function toggleSelectAll(checked) {
        AppState.selectedUserUIDs.clear(); // Siempre limpia la selección masiva al cambiar "Seleccionar todos".

        const userCards = document.querySelectorAll('.user-card'); 
        userCards.forEach(card => {
            const uid = card.dataset.uid;
            const checkbox = card.querySelector('.user-checkbox');
            if (checked) {
                // Si "Seleccionar todos" se está marcando, añade TODOS los visibles a AppState.selectedUserUIDs
                // y marca visualmente sus checkboxes y añade la clase 'selected'.
                AppState.selectedUserUIDs.add(uid);
                card.classList.add('selected');
                if (checkbox) checkbox.checked = true;
            } else {
                // Si "Seleccionar todos" se está desmarcando, simplemente desmarca visualmente
                // y remueve la clase 'selected'. AppState.selectedUserUIDs ya se limpió.
                card.classList.remove('selected');
                if (checkbox) checkbox.checked = false;
            }
        });
        updateBulkActionsBarVisibility(); // Controla la visibilidad de la barra (y el contador).
        updateSelectAllCheckboxState(); // Actualiza el checkbox "Seleccionar todos" (su propio estado).
    }

    /**
     * Actualiza la visibilidad de la barra de acciones masivas y el contador.
     * La barra SOLO se muestra si el checkbox "Seleccionar todos" está MARCADO COMPLETAMENTE (no indeterminado).
     */
    function updateBulkActionsBarVisibility() {
        // La barra solo se muestra si "Seleccionar todos" está completamente marcado
        // Y si realmente hay usuarios seleccionados (para evitar mostrar la barra si no hay usuarios en la vista).
        if (UIElements.selectAllUsersCheckbox.checked && !UIElements.selectAllUsersCheckbox.indeterminate && AppState.selectedUserUIDs.size > 0) {
            UIElements.bulkActionsBar.classList.add('show'); 
            UIElements.selectedCountSpan.textContent = AppState.selectedUserUIDs.size; // Solo actualiza el contador si la barra está visible.
        } else {
            UIElements.bulkActionsBar.classList.remove('show'); 
            // Restablece los inputs de la barra cuando se oculta.
            UIElements.bulkStatusSelect.value = '';
            UIElements.bulkRoleSelect.value = '';
            UIElements.bulkBossSelect.value = '';
            UIElements.bulkStoreInput.value = '';
            UIElements.bulkDepartmentInput.value = '';
            UIElements.selectedCountSpan.textContent = '0'; // Asegura que el contador vuelva a 0 si la barra se oculta.
        }
    }

    /**
     * Actualiza el estado del checkbox "Seleccionar todos" (marcado, desmarcado, indeterminado).
     * Este estado se basa en la cantidad de checkboxes individuales visiblemente marcados.
     */
    function updateSelectAllCheckboxState() {
        if (!UIElements.selectAllUsersCheckbox) return;

        const allVisibleUsersUIDs = AppState.filteredUsers.map(user => user.uid);
        // Contamos cuántos de los UIDs en filteredUsers están también en AppState.selectedUserUIDs.
        let checkedCountInSelectedSet = 0;
        allVisibleUsersUIDs.forEach(uid => {
            if (AppState.selectedUserUIDs.has(uid)) {
                checkedCountInSelectedSet++;
            }
        });

        if (allVisibleUsersUIDs.length === 0) {
            UIElements.selectAllUsersCheckbox.checked = false;
            UIElements.selectAllUsersCheckbox.indeterminate = false;
        } else if (checkedCountInSelectedSet === allVisibleUsersUIDs.length) {
            UIElements.selectAllUsersCheckbox.checked = true;
            UIElements.selectAllUsersCheckbox.indeterminate = false;
        } else if (checkedCountInSelectedSet > 0) {
            UIElements.selectAllUsersCheckbox.checked = false; 
            UIElements.selectAllUsersCheckbox.indeterminate = true;
        } else {
            UIElements.selectAllUsersCheckbox.checked = false;
            UIElements.selectAllUsersCheckbox.indeterminate = false;
        }
        
        // La visibilidad de la barra (y el contador) se maneja en updateBulkActionsBarVisibility(),
        // que se llama después de esta función.
    }


    async function applyBulkActions() {
        const status = UIElements.bulkStatusSelect.value;
        const role = UIElements.bulkRoleSelect.value;
        const jefeAsignado = UIElements.bulkBossSelect.value;
        const store = UIElements.bulkStoreInput.value.trim();
        const department = UIElements.bulkDepartmentInput.value.trim();

        const updates = {};
        if (status) updates.status = status;
        if (role) updates.role = role;
        if (jefeAsignado) updates.jefeAsignado = jefeAsignado || null; 
        if (store !== '') updates.store = store || null; 
        if (department !== '') updates.department = department || null; 

        if (Object.keys(updates).length === 0) {
            Swal.fire('Atención', 'Selecciona al menos una acción o ingresa un valor para aplicar.', 'warning');
            return;
        }

        // ***** VALIDACIÓN CRUCIAL: Solo procede si "Seleccionar todos" está marcado por completo. *****
        if (!UIElements.selectAllUsersCheckbox.checked || UIElements.selectAllUsersCheckbox.indeterminate) {
            Swal.fire('Atención', 'La acción masiva solo se puede aplicar cuando "Seleccionar todos" está marcado por completo.', 'warning');
            return;
        }
        
        // Antes de aplicar, nos aseguramos de que AppState.selectedUserUIDs contenga exactamente los usuarios filtrados/visibles.
        AppState.selectedUserUIDs.clear();
        AppState.filteredUsers.forEach(user => AppState.selectedUserUIDs.add(user.uid));


        if (AppState.selectedUserUIDs.size === 0) {
            Swal.fire('Atención', 'No hay usuarios seleccionados para aplicar la acción.', 'warning');
            return;
        }

        const confirmResult = await Swal.fire({
            title: '¿Estás seguro?',
            text: `Vas a aplicar cambios a ${AppState.selectedUserUIDs.size} usuarios. ¿Deseas continuar?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#E6007E',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Sí, aplicar cambios',
            cancelButtonText: 'Cancelar'
        });

        if (!confirmResult.isConfirmed) {
            return;
        }

        Swal.fire({
            title: 'Aplicando cambios...',
            text: 'Por favor espera',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const batch = db.batch();
        let changesAppliedCount = 0;

        AppState.selectedUserUIDs.forEach(uid => {
            const userRef = db.collection("usuarios").doc(uid);
            batch.update(userRef, updates);
            changesAppliedCount++;

            const userIndexAll = AppState.allUsers.findIndex(u => u.uid === uid);
            if (userIndexAll > -1) Object.assign(AppState.allUsers[userIndexAll], updates);
            const userIndexFiltered = AppState.filteredUsers.findIndex(u => u.uid === uid);
            if (userIndexFiltered > -1) Object.assign(AppState.filteredUsers[userIndexFiltered], updates);
        });

        try {
            await batch.commit();
            Swal.fire({
                icon: 'success',
                title: 'Cambios Aplicados',
                text: `${changesAppliedCount} usuarios actualizados exitosamente.`,
                timer: 2000,
                showConfirmButton: false
            });
            
            // Limpia la selección masiva y desmarca el checkbox "Seleccionar todos" después de aplicar.
            AppState.selectedUserUIDs.clear(); 
            if (UIElements.selectAllUsersCheckbox) {
                UIElements.selectAllUsersCheckbox.checked = false;
                UIElements.selectAllUsersCheckbox.indeterminate = false;
            }
            renderUserCards(AppState.filteredUsers); // Re-renderiza para reflejar los cambios y limpiar visualmente.
        } catch (error) {
            console.error("Error al aplicar cambios masivos:", error);
            Swal.fire('Error', 'Hubo un problema al aplicar los cambios.', 'error');
        } finally {
            // Restablece los inputs de la barra de acciones masivas.
            UIElements.bulkStatusSelect.value = '';
            UIElements.bulkRoleSelect.value = '';
            UIElements.bulkBossSelect.value = '';
            UIElements.bulkStoreInput.value = '';
            UIElements.bulkDepartmentInput.value = '';
            updateBulkActionsBarVisibility(); // Oculta la barra.
        }
    }
});